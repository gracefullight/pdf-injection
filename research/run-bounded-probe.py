"""Run a local research command with observed RSS/time limits and durable logs.

RSS polling is a best-effort safeguard, not a hard Metal/GPU memory limit.
Only the directly launched child process is signalled; no process-name matching.
"""

import argparse
import json
import subprocess
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--rss-gib", type=float, default=8)
    parser.add_argument("--seconds", type=float, default=180)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or not 1 <= args.rss_gib <= 10 or not 1 <= args.seconds <= 900:
        parser.error("provide a command; RSS must be 1..10 GiB, time 1..900 seconds")
    args.output.mkdir(parents=True, exist_ok=False)
    report = {
        "command": command,
        "rss_limit_gib": args.rss_gib,
        "time_limit_seconds": args.seconds,
        "max_observed_rss_bytes": 0,
    }
    started = time.monotonic()
    reason = None
    with (args.output / "process.log").open("w") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        report["pid"] = process.pid
        while process.poll() is None:
            usage = subprocess.run(
                ["ps", "-o", "rss=", "-p", str(process.pid)],
                capture_output=True,
                text=True,
                check=False,
            )
            if usage.returncode == 0 and usage.stdout.strip().isdigit():
                rss = int(usage.stdout.strip()) * 1024
                report["max_observed_rss_bytes"] = max(
                    report["max_observed_rss_bytes"], rss
                )
                if rss > args.rss_gib * 1024**3:
                    reason = "observed_rss_limit"
            if time.monotonic() - started > args.seconds:
                reason = "time_limit"
            if reason:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                break
            time.sleep(0.5)
        report["exit_code"] = process.wait()
    report.update(stop_reason=reason, seconds=round(time.monotonic() - started, 2))
    (args.output / "run.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
