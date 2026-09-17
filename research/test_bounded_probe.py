import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

RUNNER = Path(__file__).with_name("run-bounded-probe.py")


class BoundedProbeTests(unittest.TestCase):
    def run_probe(self, folder, program, seconds=10):
        return subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--seconds",
                str(seconds),
                str(folder),
                "--",
                sys.executable,
                "-c",
                program,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=15,
        )

    def test_completed_child_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "run"
            result = self.run_probe(folder, "print('probe completed')")
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((folder / "run.json").read_text())
            self.assertEqual(report["exit_code"], 0)
            self.assertIsNone(report["stop_reason"])
            log = (folder / "process.log").read_text()
            self.assertIn("probe completed", log)
            second = self.run_probe(folder, "print('overwrite')")
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual((folder / "process.log").read_text(), log)

    def test_time_limit_stops_the_started_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "run"
            result = self.run_probe(folder, "import time; time.sleep(10)", seconds=1)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((folder / "run.json").read_text())
            self.assertEqual(report["stop_reason"], "time_limit")
            self.assertNotEqual(report["exit_code"], 0)
            self.assertLess(report["seconds"], 8)


if __name__ == "__main__":
    unittest.main()
