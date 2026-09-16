"""Execute DAT: enable Start, Frame Start and Exit. See production setup."""


def onStart():
    old = me.fetch('cue_namespace', None, search=False)
    if old is not None:
        old['stop']()
    me.store('cue_namespace', None)
    me.storeStartupValue('cue_namespace', None)
    source = op('td_receive_production')
    if source is None:
        raise ValueError('Create Text DAT td_receive_production with the full receiver script')
    namespace = {'__name__': 'blackbox_cue_runtime', 'op': parent().op}
    exec(compile(source.text, source.path, 'exec'), namespace, namespace)
    namespace['start']()
    me.store('cue_namespace', namespace)


def onFrameStart(frame):
    namespace = me.fetch('cue_namespace', None, search=False)
    if namespace is not None:
        namespace['pump']()


def onExit():
    namespace = me.fetch('cue_namespace', None, search=False)
    if namespace is not None:
        namespace['stop']()
    me.store('cue_namespace', None)
