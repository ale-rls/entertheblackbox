from bridge.state import Registry


def make() -> Registry:
    return Registry(("1", "2"), flag_after_s=20.0)


def test_inactive_player_never_flagged():
    r = make()
    r.register("1")
    r.update_listeners({}, now=1000.0)
    snap = r.snapshot("1", now=2000.0)
    assert snap["flagged"] is False and snap["connected"] is False


def test_flag_after_grace_period():
    r = make()
    r.record_push("1", "intro.mp3", "interrupt", now=1000.0)
    r.update_listeners({}, now=1000.0)
    assert r.snapshot("1", now=1010.0)["flagged"] is False  # inside grace
    assert r.snapshot("1", now=1021.0)["flagged"] is True


def test_listener_clears_flag_and_resets_clock():
    r = make()
    r.record_push("1", "intro.mp3", "interrupt", now=1000.0)
    r.update_listeners({"1": 1}, now=1030.0)
    assert r.snapshot("1", now=1030.0)["flagged"] is False
    # drops off again: grace restarts from last sighting
    r.update_listeners({}, now=1040.0)
    assert r.snapshot("1", now=1045.0)["flagged"] is False
    assert r.snapshot("1", now=1055.0)["flagged"] is True


def test_push_activates_and_records():
    r = make()
    r.record_push("2", "q1.mp3", "queue", now=5.0)
    snap = r.snapshot("2", now=6.0)
    assert snap["active"] and snap["last_file"] == "q1.mp3" and snap["last_mode"] == "queue"


def test_explicit_deactivate():
    r = make()
    r.record_push("1", "x.mp3", "interrupt", now=0.0)
    r.mark_active("1", False)
    r.update_listeners({}, now=100.0)
    assert r.snapshot("1", now=200.0)["flagged"] is False


def test_dynamic_player_gets_free_stream_slot():
    r = make()
    player = r.register("seat-abc")
    assert player.stream_id == "1"
    assert r.register("seat-abc") is player
    assert r.register("seat-def").stream_id == "2"
    assert r.capacity() == {"total": 2, "assigned": 2, "available": 0}


def test_listener_counts_are_mapped_from_mount_to_player():
    r = make()
    r.register("seat-abc")
    r.update_listeners({"1": 1}, now=10.0)
    snap = r.snapshot("seat-abc", now=10.0)
    assert snap["connected"] is True
    assert snap["stream_id"] == "1"


def test_release_makes_stream_slot_reusable():
    r = make()
    first = r.register("first")
    r.release("first")
    second = r.register("second")
    assert first.stream_id == second.stream_id == "1"
    assert r.get("first") is None
