"""Checks for explicit GPU selection without creating a CUDA context."""
import contextlib
import io
import json
import unittest
from unittest.mock import patch

import gpu_binding


class BindingTests(unittest.TestCase):
    def run_binding(self, processes='', used=4, allocation=1):
        responses = [json.dumps({'Jobs': {'test': {'job_state': 'R',
                     'Resource_List': {'ngpus': allocation}}}}),
                     f'GPU-test, RTX PRO 6000, 97887, {used}, 0\n', processes]
        with patch('sys.argv', ['gpu_binding', '--uuid', 'GPU-test', '--host', 'node']), \
             patch.dict('os.environ', {'PBS_JOBID': 'test'}), \
             patch('socket.gethostname', return_value='node.example'), \
             patch('subprocess.check_output', side_effect=responses), \
             contextlib.redirect_stdout(io.StringIO()):
            gpu_binding.main()

    def test_idle_reserved_gpu_is_accepted(self):
        self.run_binding()

    def test_occupied_gpu_is_rejected(self):
        with self.assertRaises(RuntimeError):
            self.run_binding(processes='GPU-test, 123, 1024\n')
        with self.assertRaises(RuntimeError):
            self.run_binding(used=1024)

    def test_wrong_allocation_is_rejected(self):
        with self.assertRaises(RuntimeError):
            self.run_binding(allocation=0)


if __name__ == '__main__':
    unittest.main()
