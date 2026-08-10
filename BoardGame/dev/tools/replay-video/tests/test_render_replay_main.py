import json
import os
import render_replay

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'sample-bundle.json')


class FakeEncoder:
    """Stands in for encode.VideoEncoder — records frame count/size instead
    of invoking ffmpeg, so this test doesn't need ffmpeg installed.
    """
    instances = []

    def __init__(self, width, height, fps, output_path):
        self.width, self.height, self.fps, self.output_path = width, height, fps, output_path
        self.frame_count = 0
        FakeEncoder.instances.append(self)

    def write_frame(self, pil_image):
        assert pil_image.size == (self.width, self.height)
        self.frame_count += 1

    def close(self):
        pass


def test_main_renders_expected_frame_count_and_reports_success(monkeypatch, capsys, tmp_path):
    FakeEncoder.instances = []
    monkeypatch.setattr(render_replay, 'VideoEncoder', FakeEncoder)

    output_path = str(tmp_path / 'out.mp4')
    exit_code = render_replay.main([
        FIXTURE_PATH, output_path,
        '--fps', '10', '--seconds-per-action', '1.0', '--resolution', '320x240',
    ])

    assert exit_code == 0
    encoder = FakeEncoder.instances[0]
    with open(FIXTURE_PATH, 'r', encoding='utf-8') as f:
        bundle = json.load(f)
    expected_frames = len(bundle['actions']) * 10  # 1.0s/action * 10fps = 10 frames/action
    assert encoder.frame_count == expected_frames
    assert 'Wrote' in capsys.readouterr().out


def test_main_reports_a_clean_error_when_ffmpeg_is_unavailable(monkeypatch, capsys, tmp_path):
    from encode import FFmpegNotFoundError

    class RaisingEncoder:
        def __init__(self, *a, **kw):
            raise FFmpegNotFoundError('ffmpeg was not found on PATH.')

    monkeypatch.setattr(render_replay, 'VideoEncoder', RaisingEncoder)
    exit_code = render_replay.main([FIXTURE_PATH, str(tmp_path / 'out.mp4')])
    assert exit_code == 1
    assert 'ffmpeg' in capsys.readouterr().err
