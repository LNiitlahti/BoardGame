import pytest
from encode import build_ffmpeg_command, check_ffmpeg_available, FFmpegNotFoundError


def test_build_ffmpeg_command_includes_resolution_fps_and_output_path():
    cmd = build_ffmpeg_command(1920, 1080, 30, 'out.mp4')
    assert 'ffmpeg' in cmd
    assert '1920x1080' in cmd
    assert '30' in cmd
    assert cmd[-1] == 'out.mp4'


def test_check_ffmpeg_available_raises_a_clear_error_when_missing(monkeypatch):
    import encode
    monkeypatch.setattr(encode.shutil, 'which', lambda name: None)
    with pytest.raises(FFmpegNotFoundError, match='ffmpeg'):
        check_ffmpeg_available()


def test_check_ffmpeg_available_is_a_no_op_when_present(monkeypatch):
    import encode
    monkeypatch.setattr(encode.shutil, 'which', lambda name: '/usr/bin/ffmpeg')
    check_ffmpeg_available()  # must not raise
