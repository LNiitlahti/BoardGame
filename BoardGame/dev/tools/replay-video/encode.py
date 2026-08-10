"""Pipes rendered frames into an ffmpeg subprocess to produce an mp4."""
import shutil
import subprocess


class FFmpegNotFoundError(RuntimeError):
    pass


def check_ffmpeg_available():
    if shutil.which('ffmpeg') is None:
        raise FFmpegNotFoundError(
            "ffmpeg was not found on PATH. Install it from https://ffmpeg.org/download.html "
            "(Windows: 'winget install ffmpeg', macOS: 'brew install ffmpeg', "
            "Linux: 'apt install ffmpeg') and try again."
        )


def build_ffmpeg_command(width, height, fps, output_path):
    return [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-pixel_format', 'rgb24',
        '-video_size', f'{width}x{height}',
        '-framerate', str(fps),
        '-i', '-',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        output_path,
    ]


class VideoEncoder:
    """Pipes raw RGB frames into an ffmpeg subprocess, producing an mp4 at
    `output_path`. Call write_frame() per frame, then close() once.
    """

    def __init__(self, width, height, fps, output_path):
        check_ffmpeg_available()
        self._process = subprocess.Popen(
            build_ffmpeg_command(width, height, fps, output_path),
            stdin=subprocess.PIPE,
        )

    def write_frame(self, pil_image):
        self._process.stdin.write(pil_image.tobytes())

    def close(self):
        self._process.stdin.close()
        self._process.wait()
