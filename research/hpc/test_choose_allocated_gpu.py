import unittest
from choose_allocated_gpu import select_device


class DeviceSelectionTests(unittest.TestCase):
    def setUp(self):self.devices=[['0','GPU-a','RTX','97887','4','0'],['1','GPU-b','RTX','97887','4000','50']]
    def test_unique_idle_device(self):self.assertEqual(select_device(self.devices,[['GPU-b','1','4000']]),'GPU-a')
    def test_honors_visibility(self):
        with self.assertRaises(RuntimeError):select_device(self.devices,[],visible='1')
    def test_rejects_ambiguous_idle(self):
        self.devices[1][-2:]=['4','0']
        with self.assertRaises(RuntimeError):select_device(self.devices,[])
    def test_rejects_active_process(self):
        with self.assertRaises(RuntimeError):select_device(self.devices,[['GPU-a','2','20']])


if __name__=='__main__':unittest.main()
