import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from PIL import Image

from precision_continuation import SplitPrecisionRunner, evaluate_condition, validate_inputs


class FakeRunner:
    device='test-device'
    def __init__(self,tag):self.tag=tag;self.calls=[]
    def state(self,*args):return self.tag+'-state'
    def loss(self,*args):return self.tag+'-loss'
    def generate(self,images,prompt,max_new_tokens=192):
        self.calls.append(max_new_tokens)
        return {'prompt':prompt,'response':'answer','new_tokens':1,'incomplete':False,'ended_with_eos':True}


class PrecisionContinuationTests(unittest.TestCase):
    def test_optimizer_and_evaluator_are_separate(self):
        optimizer=FakeRunner('fp32');evaluator=FakeRunner('bf16');runner=SplitPrecisionRunner(optimizer,evaluator)
        self.assertEqual(runner.state(),'fp32-state');self.assertEqual(runner.loss(),'fp32-loss')
        runner.generate([], 'question')
        self.assertEqual(optimizer.calls,[]);self.assertEqual(evaluator.calls,[192])

    def test_failed_reference_stops_before_model_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'report.json').write_text('{"status":"failed_numerical_reference","reference_passed":false}')
            (root/'manifest.json').write_text('{}');(root/'old.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError,'Numerical reference failed'):
                validate_inputs(SimpleNamespace(preflight=root/'report.json',previous_pilot=root,previous_preflight=root/'old.json'))

    def test_limits_and_pixel_order_are_in_cache_identity(self):
        config={'test':[{'id':'T1','prompt':'Question','leakage_rubric':'test'}],
                'utility_test':[{'id':'V1','prompt':'Layout','target':'answer'}]}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);cache=root/'cache';cache.mkdir();runner=FakeRunner('bf16')
            images=[Image.new('RGB',(2,2),'white'),Image.new('RGB',(2,2),'black')]
            with (root/'raw.jsonl').open('w') as raw:
                first=evaluate_condition(runner,images,config,cache,'first',raw)
                second=evaluate_condition(runner,images,config,cache,'second',raw)
                evaluate_condition(runner,list(reversed(images)),config,cache,'reversed',raw)
            self.assertEqual(runner.calls,[192,768,64]*2)
            self.assertTrue(first[1]['short_response_is_prefix'])
            self.assertTrue(all(x['reused_identical_input_response'] for x in second))
            self.assertEqual(len(list(cache.glob('*.json'))),6)


if __name__=='__main__':unittest.main()
