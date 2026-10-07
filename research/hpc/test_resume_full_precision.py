import copy
import unittest
from diagnose_full_precision import STEPS
from numerical_protocol import comparison
from resume_full_precision import validated_prefix


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.row = {'checks': [comparison(10., 1. + 10. * h, 1. - 10. * h, h) for h in STEPS[:3]]}

    def test_completed_prefix_is_preserved_without_aliasing(self):
        checks = validated_prefix(self.row, 10.)
        self.assertEqual(checks, self.row['checks'])
        checks[0]['agrees'] = False
        self.assertTrue(self.row['checks'][0]['agrees'])

    def test_reordered_steps_and_changed_gradient_rejected(self):
        bad = copy.deepcopy(self.row)
        bad['checks'].reverse()
        with self.assertRaises(ValueError):
            validated_prefix(bad, 10.)
        with self.assertRaises(ValueError):
            validated_prefix(self.row, 11.)

    def test_corrupted_decision_rejected(self):
        bad = copy.deepcopy(self.row)
        bad['checks'][0]['agrees'] = False
        with self.assertRaises(ValueError):
            validated_prefix(bad, 10.)


if __name__ == '__main__':
    unittest.main()
