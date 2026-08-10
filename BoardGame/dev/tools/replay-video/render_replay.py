#!/usr/bin/env python3
"""Renders an exported tournament-video-*.json bundle (from replay.html's
"Export Video Data" button) into an mp4 video. See README.md for usage.
"""
import argparse
import json
import sys
import os

from config import load_config, apply_overrides
from state import iter_frames_state, TileChangeTracker, SpellToastQueue
from draw import render_frame
from encode import VideoEncoder, FFmpegNotFoundError


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


def main(argv=None):
    args = parse_args(argv)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = args.config or os.path.join(script_dir, 'config.json')
    config = apply_overrides(load_config(config_path), overrides_from_args(args))

    try:
        with open(args.bundle, 'r', encoding='utf-8') as f:
            bundle = json.load(f)
    except FileNotFoundError:
        print(f"Error: bundle file not found: {args.bundle}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"Error: {args.bundle} is not valid JSON: {e}", file=sys.stderr)
        return 1

    try:
        encoder = VideoEncoder(config['width'], config['height'], config['fps'], args.output)
    except FFmpegNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    tile_tracker = TileChangeTracker(capacity=config['recency_tile_count'])
    toast_queue = SpellToastQueue(duration_seconds=config['spell_toast_duration_seconds'])
    frames_per_action = max(1, round(config['seconds_per_action'] * config['fps']))

    frame_index = 0
    try:
        for action, state, effect in iter_frames_state(bundle):
            if effect:
                if effect.get('tile_changes'):
                    tile_tracker.record_many(effect['tile_changes'])
                if effect.get('toast'):
                    toast = effect['toast']
                    requested_at = frame_index / config['fps']
                    toast_queue.add(toast['teamName'], toast['spellName'], requested_at)

            for _ in range(frames_per_action):
                t = frame_index / config['fps']
                active_toast = toast_queue.active_toast_at(t)
                image = render_frame(state, tile_tracker, active_toast, config)
                encoder.write_frame(image)
                frame_index += 1
    finally:
        encoder.close()

    print(f"Wrote {args.output} ({frame_index} frames, {frame_index / config['fps']:.1f}s)")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
