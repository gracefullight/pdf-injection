import unittest
import numpy as np
from numerical_protocol import STEPS, ULP_STEPS, comparison, directions, interior_states, stable_agreement, representable_pair


class NumericalProtocolTests(unittest.TestCase):
    def test_known_quadratic_derivative(self):
        x=np.array([.2,.6], dtype=np.float64); direction=np.array([1.,-1.])
        analytic=float(np.dot(2*x,direction))
        checks=[comparison(analytic,float(np.sum((x+h*direction)**2)),
                           float(np.sum((x-h*direction)**2)),h) for h in STEPS]
        self.assertTrue(stable_agreement(checks))
        self.assertFalse(stable_agreement([comparison(analytic*3,c['plus_loss'],c['minus_loss'],c['step']) for c in checks]))

    def test_requires_adjacent_agreement(self):
        self.assertFalse(stable_agreement([{'agrees':True},{'agrees':False},{'agrees':True}]))
        self.assertTrue(stable_agreement([{'agrees':False},{'agrees':True},{'agrees':True}]))

    def test_feasibility_and_disjoint_directions(self):
        source=np.full((56,56,3),255,dtype=np.uint8)
        lo=source.astype(np.float32)/255-8/255;hi=np.ones_like(lo)
        protected=np.zeros((56,56),dtype=bool);protected[25:31,25:31]=True
        lo[protected]=1;hi[protected]=1
        states=interior_states(source,source,lo,hi)
        ds=directions(np.ones_like(lo),protected)
        np.testing.assert_array_equal(ds['even_tiles']+ds['odd_tiles'],ds['all'])
        for x in states.values():
            for d in ds.values():
                self.assertEqual(np.count_nonzero(d[protected]),0)
                self.assertTrue(np.all(x-max(STEPS)*d>=lo))
                self.assertTrue(np.all(x+max(STEPS)*d<=hi))

    def test_zero_direction_rejected(self):
        with self.assertRaises(ValueError):directions(np.zeros((56,56,3)),np.zeros((56,56),dtype=bool))

    def test_ulp_steps_change_background_exactly_and_preserve_ink(self):
        base=np.array([.97,.985,.99,.2],dtype=np.float32)
        direction=np.array([1,-1,1,0],dtype=np.float32)
        for h in ULP_STEPS:
            plus,minus=representable_pair(base,direction,h)
            np.testing.assert_array_equal(plus-base,h*direction)
            np.testing.assert_array_equal(base-minus,h*direction)
            self.assertEqual(plus[-1],base[-1])
            self.assertEqual(minus[-1],base[-1])

    def test_sub_ulp_or_rounded_steps_rejected(self):
        for h in (1e-8,1e-6):
            with self.assertRaisesRegex(ValueError,'not exactly representable'):
                representable_pair(np.array([.985],dtype=np.float32),np.ones(1,dtype=np.float32),h)


if __name__=='__main__':unittest.main()
