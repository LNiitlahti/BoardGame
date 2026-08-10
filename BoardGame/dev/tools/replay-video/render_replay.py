#!/usr/bin/env python3
"""Renders an exported tournament-video-*.json bundle (from replay.html's
"Export Video Data" button) into an mp4 video. See README.md for usage.
"""
import argparse


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='Render a tournament replay bundle into a video.'
    )
    parser.add_argument('bundle', help='Path to the exported tournament-video-*.json bundle')
    parser.add_argument('output', help='Path to write the output video (e.g. output.mp4)')
    # Consumed by main() (added in a later task), not by overrides_from_args.
    parser.add_argument('--config', default=None, help='Path to a config.json (defaults to config.json next to this script)')
    parser.add_argument('--fps', type=int, default=None)
    parser.add_argument('--resolution', default=None, help='WIDTHxHEIGHT, e.g. 1920x1080')
    parser.add_argument('--seconds-per-action', type=float, default=None)
    parser.add_argument('--recency-count', type=int, default=None)
    parser.add_argument('--recency-brightness-max', type=float, default=None)
    parser.add_argument('--recency-brightness-min', type=float, default=None)
    parser.add_argument('--toast-duration', type=float, default=None)
    return parser.parse_args(argv)


def overrides_from_args(args):
    overrides = {
        'fps': args.fps,
        'seconds_per_action': args.seconds_per_action,
        'recency_tile_count': args.recency_count,
        'recency_brightness_max': args.recency_brightness_max,
        'recency_brightness_min': args.recency_brightness_min,
        'spell_toast_duration_seconds': args.toast_duration,
    }
    if args.resolution:
        parts = args.resolution.lower().split('x')
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            raise SystemExit(
                f"--resolution must be in WIDTHxHEIGHT format (e.g. 1920x1080), got: {args.resolution!r}"
            )
        overrides['width'] = int(parts[0])
        overrides['height'] = int(parts[1])
    return overrides
