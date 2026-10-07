"""Validate an explicitly selected idle GPU inside a one-GPU PBS allocation.

For sites that count GPUs but do not set CUDA_VISIBLE_DEVICES. This records a
point-in-time occupancy check, not scheduler-enforced device isolation.
"""
import argparse
import csv
import io
import json
import os
import socket
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uuid', required=True)
    parser.add_argument('--host', required=True)
    args = parser.parse_args()
    job = os.environ['PBS_JOBID']
    host = socket.gethostname().split('.')[0]
    if host != args.host or not args.uuid.startswith('GPU-'):
        raise RuntimeError('Unexpected host or GPU identifier')
    allocation = json.loads(subprocess.check_output(
        ['qstat', '-f', '-F', 'json', job], text=True))['Jobs'][job]
    if int(allocation['Resource_List']['ngpus']) != 1 or allocation['job_state'] != 'R':
        raise RuntimeError('An active one-GPU allocation is required')
    def query(kind, fields):
        output = subprocess.check_output(['nvidia-smi', '-i', args.uuid,
            f'--query-{kind}={fields}', '--format=csv,noheader,nounits'], text=True)
        return [[value.strip() for value in row] for row in csv.reader(io.StringIO(output))]
    devices = query('gpu', 'uuid,name,memory.total,memory.used,utilization.gpu')
    if len(devices) != 1 or devices[0][0] != args.uuid:
        raise RuntimeError('GPU UUID lookup did not match')
    processes = query('compute-apps', 'gpu_uuid,pid,used_memory')
    if processes or int(devices[0][3]) > 256 or int(devices[0][4]) != 0:
        raise RuntimeError('Selected GPU is occupied; refusing to start model compute')
    print(json.dumps({'binding': 'explicit_uuid_with_idle_check', 'device': devices[0],
                      'scheduler_enforced_isolation': False}), flush=True)


if __name__ == '__main__':
    main()
