import React, { useEffect, useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { PROTOCOL_VERSION, type PhoneToServerMessage, type StaffAssignResultMessage, type StaffMenuMessage } from '@entertheblackbox/protocol';
import { Text } from './Text';
import { STAFF_CLOSED, STAFF_LONG_PRESS_MS, staffAssign, staffOpen, staffPinInput, staffReply, staffUnlock, type StaffMenuState } from './staff-menu';

const button = { padding: 16, borderWidth: 1, borderColor: '#888', borderRadius: 8 } as const;

/** Hidden staff menu: hold the top-right corner, enter the PIN, assign a pick to this tablet. */
export function StaffMenu({ connected, reply, send }: { connected: boolean; reply: StaffMenuMessage | StaffAssignResultMessage | null; send: (message: PhoneToServerMessage) => void }) {
  const [state, setState] = useState<StaffMenuState>(STAFF_CLOSED);
  useEffect(() => { if (reply) setState(current => staffReply(current, reply)); }, [reply]);
  useEffect(() => { if (!connected) setState(STAFF_CLOSED); }, [connected]);
  const unlock = () => {
    const next = staffUnlock(state);
    setState(next);
    if (next.step === 'unlocking') send({ t: 'staff_menu_request', v: PROTOCOL_VERSION, pin: next.pin });
  };
  const assign = (pickId: string) => { setState(staffAssign(state)); send({ t: 'staff_assign', v: PROTOCOL_VERSION, pin: state.pin, pickId }); };
  const busy = state.step === 'unlocking' || state.step === 'assigning';
  return <>
    <Pressable accessibilityLabel="Staff menu" onLongPress={() => { if (connected) setState(staffOpen()); }} delayLongPress={STAFF_LONG_PRESS_MS}
      style={{ position: 'absolute', top: 0, right: 0, width: 72, height: 72 }} />
    <Modal visible={state.step !== 'closed'} transparent animationType="fade" onRequestClose={() => setState(STAFF_CLOSED)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.85)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#202226', borderRadius: 12, padding: 20, gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: 'white', fontSize: 22 }}>Staff</Text>
          {(state.step === 'pin' || state.step === 'unlocking') && <>
            <TextInput value={state.pin} onChangeText={text => setState(staffPinInput(state, text))} onSubmitEditing={unlock}
              secureTextEntry keyboardType="number-pad" autoFocus placeholder="PIN" placeholderTextColor="#888" accessibilityLabel="Staff PIN"
              style={{ color: 'white', fontSize: 24, borderWidth: 1, borderColor: '#888', borderRadius: 8, padding: 12 }} />
            <Pressable accessibilityRole="button" disabled={busy} onPress={unlock} style={[button, { opacity: busy ? .6 : 1 }]}><Text style={{ color: 'white', fontSize: 18 }}>Unlock</Text></Pressable>
          </>}
          {(state.step === 'menu' || state.step === 'assigning') && <>
            <Text style={{ color: '#ddd' }}>Assign this tablet:</Text>
            {state.picks.map(pick => <Pressable key={pick.id} accessibilityRole="button" disabled={busy} onPress={() => assign(pick.id)} style={[button, { opacity: busy ? .6 : 1 }]}>
              <Text style={{ color: 'white', fontSize: 18 }}>{pick.label}</Text>
            </Pressable>)}
          </>}
          {!!state.message && <Text accessibilityLiveRegion="polite" style={{ color: state.ok ? '#9fe0b0' : '#ffb4a8', fontSize: 18 }}>{state.message}</Text>}
          <Pressable accessibilityRole="button" onPress={() => setState(STAFF_CLOSED)} style={button}><Text style={{ color: 'white', fontSize: 18 }}>Close</Text></Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
