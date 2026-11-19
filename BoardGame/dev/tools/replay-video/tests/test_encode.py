import pytest
from encode import build_ffmpeg_command, check_ffmpeg_available, FFmpegNotFoundError


def test_build_ffmpeg_command_includes_resolution_fps_and_output_path():
    cmd = build_ffmpeg_command(1920, 1080, 30, 'out.mp4')
    assert 'ffmpeg' in cmd
    assert '1920x1080' in cmd
    assert '30' in cmd
    assert cmd[-1] == 'out.mp4'


def test_build_ffmpeg_command_uses_a_fast_x264_preset_by_default():
    # libx264 defaults to "medium" when -preset is omitted, which is the
    # main reason rendering felt slow for a private, throwaway replay video
    # where file size doesn't matter. x264 presets only trade compression
    # EFFICIENCY (bigger file) for speed at a fixed -crf quality target --
    # they don't lower the quality target itself -- so "ultrafast" is safe
    # for this always-simple, flat-color content (no photographic detail
    # for a fast preset's cruder mode decisions to visibly hurt).
    cmd = build_ffmpeg_command(1920, 1080, 30, 'out.mp4')
    assert '-preset' in cmd
    assert cmd[cmd.index('-preset') + 1] == 'ultrafast'


def test_check_ffmpeg_available_raises_a_clear_error_when_missing(monkeypatch):
    import encode
    monkeypatch.setattr(encode.shutil, 'which', lambda name: None)
    with pytest.raises(FFmpegNotFoundError, match='ffmpeg'):
        check_ffmpeg_available()


def test_check_ffmpeg_available_is_a_no_op_when_present(monkeypatch):
    import encode
    monkeypatch.setattr(encode.shutil, 'which', lambda name: '/usr/bin/ffmpeg')
    check_ffmpeg_available()  # must not raise
