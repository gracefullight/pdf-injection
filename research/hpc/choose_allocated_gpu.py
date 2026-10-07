"""Resolve a unique idle GPU inside a PBS allocation before CUDA is initialized."""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import socket
import subprocess


def select_device(devices, processes, visible=None):
    allowed=None if not visible else {x.strip() for x in visible.split(',')}
    occupied={x[0] for x in processes}
    eligible=[]
    for index,uuid,name,total,used,util in devices:
        if allowed is not None and index not in allowed and uuid not in allowed:continue
        if uuid in occupied or int(used)>256 or int(util)!=0 or int(total)<80000:continue
        eligible.append(uuid)
    if len(eligible)!=1:
        raise RuntimeError('Expected exactly one eligible idle GPU; device ownership is ambiguous or capacity is insufficient')
    return eligible[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--record',type=Path,required=True);args=parser.parse_args()
    job=os.environ['PBS_JOBID'];host=socket.gethostname().split('.')[0]
    allocation=json.loads(subprocess.check_output(['qstat','-f','-F','json',job],text=True))['Jobs'][job]
    if allocation['job_state']!='R' or int(allocation['Resource_List']['ngpus'])!=1:
        raise RuntimeError('Active one-GPU PBS allocation required')
    if host not in allocation.get('exec_host','').split('/')[0]:raise RuntimeError('Allocation host mismatch')
    def query(kind,fields):
        s=subprocess.check_output(['nvidia-smi',f'--query-{kind}={fields}','--format=csv,noheader,nounits'],text=True)
        return [[x.strip() for x in row] for row in csv.reader(io.StringIO(s)) if row]
    devices=query('gpu','index,uuid,name,memory.total,memory.used,utilization.gpu')
    processes=query('compute-apps','gpu_uuid,pid,used_memory')
    args.record.write_text(json.dumps({'status':'inventory_before_selection','host':host,
                           'job':job,'devices':devices,'processes':processes,
                           'cuda_visible_devices':os.environ.get('CUDA_VISIBLE_DEVICES')},indent=2)+'\n')
    selected=select_device(devices,processes,os.environ.get('CUDA_VISIBLE_DEVICES'))
    # Recheck immediately with the established explicit-UUID guard.
    subprocess.run([os.sys.executable,str(Path(__file__).with_name('gpu_binding.py')),'--uuid',selected,'--host',host],check=True,stdout=subprocess.PIPE)
    args.record.write_text(json.dumps({'host':host,'job':job,'uuid':selected,'devices':devices,'processes':processes,
                           'scheduler_enforced_isolation':False,'note':'Unique idle device at startup; this is not scheduler-enforced isolation.'},indent=2)+'\n')
    print(selected)


if __name__=='__main__':main()
