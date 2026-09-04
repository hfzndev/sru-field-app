import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert, Button, Field, Input, Loading, Screen } from '@/components/ui';
import {
  BIG_TOUCH_TARGET, STATUS_LABEL, colors, radius, space, type,
} from '@/constants/theme';
import {
  EQUIPMENT_STATUSES, EquipmentRow, EquipmentStatus, enqueueEquipmentStatus, getEquipment,
} from '@/lib/queue';
import { Session, getSession } from '@/lib/session';

/**
 * Change one piece of equipment's status (doc 02 §1.2, doc 03 §3.5).
 *
 * Two rules drive the layout. The four statuses are buttons rather than a
 * picker, because the operator is often wearing gloves and looking at the
 * machine rather than the phone. And the description is genuinely mandatory —
 * "On Repair" with no explanation tells the next shift nothing about what is
 * wrong or who to ask, which is the failure this record type exists to prevent.
 *
 * It saves offline like everything else. The operator is standing at the pump,
 * not in the control room where the signal is.
 */
const HINTS: Record<EquipmentStatus, string> = {
  NORMAL: 'Beroperasi normal.',
  STANDBY: 'Siap pakai tapi sedang tidak dijalankan.',
  ON_REPAIR: 'Sedang diperbaiki.',
  NEED_REPAIR: 'Rusak dan menunggu perbaikan.',
};

export default function EquipmentStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const equipmentId = Number(id);

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [item, setItem] = useState<EquipmentRow | null>(null);
  const [status, setStatus] = useState<EquipmentStatus | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const [current, row] = await Promise.all([getSession(), getEquipment(equipmentId)]);
      if (ignore) return;
      setSession(current);
      setItem(row);
    })();
    return () => { ignore = true; };
  }, [equipmentId]);

  async function save() {
    if (!session || !item) return;

    if (!status) {
      setError('Pilih status barunya dulu.');
      return;
    }
    if (!description.trim()) {
      setError('Keterangan wajib diisi — shift berikutnya membacanya.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await enqueueEquipmentStatus({
        equipmentId: item.id,
        newStatus: status,
        description: description.trim(),
        // Read at save time, not on mount: a form left open while the operator
        // looked at the machine should record when they pressed the button.
        changedAt: new Date().toISOString(),
        operatorName: session.operatorName,
        shiftGroup: session.shiftName,
        shiftTime: session.shiftTime,
      });
      router.replace({
        pathname: '/(tabs)/maintenance',
        params: { saved: `${item.tagNumber} → ${STATUS_LABEL[status] ?? status}` },
      });
    } catch {
      setError('Gagal menyimpan di HP. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) return <Screen><Loading /></Screen>;
  if (!session) {
    return (
      <Screen>
        <Alert error="Sesi shift tidak ditemukan. Login ulang sebelum mencatat." />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen>
        <Alert error="Alat tidak ditemukan di HP ini." />
        <Button title="Kembali" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Alert error={error || null} />

      <Field
        label={`${item.tagNumber} — status baru`}
        hint={`Sekarang: ${STATUS_LABEL[item.status] ?? item.status}`}
      >
        <View style={styles.options}>
          {EQUIPMENT_STATUSES.map((value) => {
            const selected = status === value;
            const current = item.status === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => { setStatus(value); setError(''); }}
                style={[styles.option, selected && styles.optionOn]}
              >
                <Text style={[styles.optionLabel, selected && styles.optionLabelOn]}>
                  {STATUS_LABEL[value] ?? value}
                  {current ? ' · sekarang' : ''}
                </Text>
                <Text style={[styles.optionHint, selected && styles.optionHintOn]}>
                  {HINTS[value]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field
        label="Keterangan (wajib)"
        hint="Apa yang terlihat atau terdengar, dan apa yang sudah dilakukan."
      >
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder="mis. bearing berisik, getaran tinggi, sudah lapor maintenance"
          multiline
        />
      </Field>

      <Button
        title={busy ? 'Menyimpan…' : 'Simpan perubahan'}
        variant="primary"
        size="big"
        busy={busy}
        onPress={save}
      />

      <Text style={styles.footnote}>
        Tersimpan di HP dan terkirim saat ada sinyal. HP lain melihat status dan
        keterangan ini setelah sync.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { gap: space.sm },
  option: {
    minHeight: BIG_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    justifyContent: 'center',
  },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionLabel: { ...type.bodyStrong, color: colors.text },
  optionLabelOn: { color: colors.accent },
  optionHint: { ...type.caption, color: colors.muted, marginTop: 2 },
  optionHintOn: { color: colors.accent },
  footnote: { ...type.caption, color: colors.muted, marginTop: space.lg },
});
