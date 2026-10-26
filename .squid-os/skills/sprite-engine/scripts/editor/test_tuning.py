"""Run: python3 -B -m unittest discover -s .squid-os/skills/sprite-engine/scripts/editor -p 'test_*.py' -v"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

SPEC = importlib.util.spec_from_file_location('record_tuning', Path(__file__).resolve().parent.parent / 'record_tuning.py')
tuning = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tuning)
DIRECTIONS = ('forward', 'reverse', 'ping_pong', 'ping_pong_reverse')


class TuningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home() / 'tmp')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'sheet.json'
        self.sheet = dict(file='sheet.png', size='100x100', rows=1, cols=2, kind='animation',
                          description='fixture', entities=[dict(name='hero', anim='idle',
                          frames=[dict(file='1.png', bbox=[0, 0, 10, 10]), dict(file='2.png')])])
        self.path.write_text(json.dumps(self.sheet))
        self.args = SimpleNamespace(sheet=str(self.path), name='hero', anim='idle')

    def test_all_eight_disk_roundtrips_and_clear(self):
        for mode in ('loop', 'once'):
            for direction in DIRECTIONS:
                with self.subTest(mode=mode, direction=direction):
                    self.args.data = json.dumps(dict(playback=mode, direction=direction,
                                                     frames=[dict(durUnits=2), dict(durUnits=5)]))
                    with contextlib.redirect_stdout(io.StringIO()):
                        tuning.cmd_write(self.args)
                    sheet = tuning.load_sheet(str(self.path))
                    entity = tuning.find_entity(sheet, 'hero', 'idle')
                    self.assertEqual(entity['direction'], direction)
                    self.assertEqual(entity['playback'], mode)
                    self.assertEqual([f['durUnits'] for f in entity['frames']], [2, 5])
                    self.assertEqual(entity['frames'][0]['bbox'], [0, 0, 10, 10])
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        tuning.cmd_read(self.args)
                    self.assertEqual(json.loads(out.getvalue())['direction'], direction)
        with contextlib.redirect_stdout(io.StringIO()):
            tuning.cmd_clear(self.args)
        self.assertEqual(tuning.load_sheet(str(self.path)), self.sheet)

    def test_invalid_direction_rejected_without_disk_mutation(self):
        before = self.path.read_bytes()
        for invalid in ('backwards', '', None, 1, ['forward']):
            with self.subTest(invalid=invalid):
                self.args.data = json.dumps(dict(direction=invalid))
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    tuning.cmd_write(self.args)
                self.assertEqual(self.path.read_bytes(), before)

    def test_legacy_omitted_direction_remains_valid(self):
        tuning.validate(self.sheet)
        self.args.data = json.dumps(dict(playback='once'))
        with contextlib.redirect_stdout(io.StringIO()):
            tuning.cmd_write(self.args)
        self.assertNotIn('direction', tuning.load_sheet(str(self.path))['entities'][0])


if __name__ == '__main__':
    unittest.main()
