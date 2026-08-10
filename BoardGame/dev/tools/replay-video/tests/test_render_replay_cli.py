from render_replay import parse_args, overrides_from_args


def test_parse_args_requires_bundle_and_output():
    args = parse_args(['bundle.json', 'out.mp4'])
    assert args.bundle == 'bundle.json'
    assert args.output == 'out.mp4'
    assert args.fps is None
    assert args.resolution is None


def test_parse_args_reads_all_override_flags():
    args = parse_args([
        'bundle.json', 'out.mp4',
        '--fps', '24',
        '--resolution', '1080x1080',
        '--seconds-per-action', '0.5',
        '--recency-count', '5',
        '--recency-brightness-max', '0.6',
        '--recency-brightness-min', '0.05',
        '--toast-duration', '1.5',
    ])
    assert args.fps == 24
    assert args.resolution == '1080x1080'
    assert args.seconds_per_action == 0.5
    assert args.recency_count == 5
    assert args.recency_brightness_max == 0.6
    assert args.recency_brightness_min == 0.05
    assert args.toast_duration == 1.5


def test_overrides_from_args_maps_flags_to_config_keys():
    args = parse_args(['bundle.json', 'out.mp4', '--fps', '24'])
    overrides = overrides_from_args(args)
    assert overrides['fps'] == 24
    assert overrides['seconds_per_action'] is None


def test_overrides_from_args_splits_resolution_into_width_and_height():
    args = parse_args(['bundle.json', 'out.mp4', '--resolution', '1080x1350'])
    overrides = overrides_from_args(args)
    assert overrides['width'] == 1080
    assert overrides['height'] == 1350


def test_overrides_from_args_omits_width_height_when_no_resolution_flag():
    args = parse_args(['bundle.json', 'out.mp4'])
    overrides = overrides_from_args(args)
    assert 'width' not in overrides
    assert 'height' not in overrides
