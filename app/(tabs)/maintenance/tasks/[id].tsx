import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { PhotoThumb } from '@/components/PhotoThumb';
import {
  Alert, Button, Card, EmptyInline, Field, Input, Loading, Screen, SectionTitle, StatusBadge,
} from '@/components/ui';
import { SHIFT_TIME_LABEL, STATUS_LABEL, colors, space, type } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import { photoUriFor } from '@/lib/photos';
import {
  TaskLogRow, TaskRow, enqueueTaskLog, getTask, listTaskLogs,
} from '@/lib/queue';
import { Session, getSession } from '@/lib/session';

/**
 * One maintenance task, and the place progress is reported (doc 03 §3.5).
 *
 * Progress is steps, not a slider. A slider on a phone held in one gloved hand
 * lands on 63% when the operator meant 60, and nobody reading it later can tell
 * the difference between a careful 63 and a slipped thumb. Steps of 25 say what
 * was meant.
 *
 * Everything here is optional except having reported *something*: a log with no
 * status and no percentage is still worth sending when it carries a note —
 * "menunggu spare part" moves no numbers and is exactly what the next shift
 * needs to read (doc 06 §5).
 */
const STEPS = [0, 25, 50, 75, 100];
const NEXT_STATUS = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;

export default function TaskDetailScreen() {
  // draftStatus/draftProgress/draftNote come back from the camera. The camera
  // hands every param it did not consume straight back to the caller, which is
  // what lets the photo be taken at any point in the form instead of only
  // first: without this the round-trip remounts this screen and silently
  // discards the progress, status and note the operator already chose.
  const { id, photoName, draftStatus, draftProgress, draftNote } = useLocalSearchParams<{
    id: string;
    photoName?: string;
    draftStatus?: string;
    draftProgress?: string;
    draftNote?: string;
  }>();
  const taskId = Number(id);

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [history, setHistory] = useState<TaskLogRow[]>([]);

  const [status, setStatus] = useState<string | null>(draftStatus || null);
  const [progress, setProgress] = useState<number | null>(
    draftProgress === undefined || draftProgress === '' ? null : Number(draftProgress),
  );
  const [note, setNote] = useState(draftNote ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const [current, row, log] = await Promise.all([
        getSession(), getTask(taskId), listTaskLogs(taskId),
      ]);
      if (ignore) return;
      setSession(current);
      setTask(row);
      setHistory(log);
    })();
    return () => { ignore = true; };
  }, [taskId]));

  // Derived from the route params, not copied into state: the camera hands the
  // photo back through them, and two sources of truth would disagree after a
  // retake.
  const photo = photoName ? photoUriFor(photoName) : '';

  async function save() {
    if (!session || !task) return;

    if (status === null && progress === null && !note.trim() && !photo) {
      setError('Belum ada yang dilaporkan — pilih status, progres, atau tulis catatan.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await enqueueTaskLog({
        taskId: task.id,
        newStatus: status,
        progressPct: progress,
        note: note.trim(),
        photoLocalUri: photo,
        // Read at save time, so a form left open while the operator worked is
        // recorded when they pressed the button.
        logTime: new Date().toISOString(),
        operatorName: session.operatorName,
        shiftGroup: session.shiftName,
        shiftTime: session.shiftTime,
      });
      router.replace({
        pathname: '/(tabs)/maintenance',
        params: { saved: `Progres ${task.title} tersimpan` },
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
  if (!task) {
    return (
      <Screen>
        <Alert error="Task tidak ditemukan di HP ini." />
        <Button title="Kembali" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Alert error={error || null} />

      <Card>
        <View style={styles.head}>
          <Text style={styles.title}>{task.title}</Text>
          <StatusBadge value={task.status} />
        </View>
        <Text style={styles.sub}>
          {[task.equipmentTag, task.equipmentName].filter(Boolean).join(' · ')}
        </Text>
        {!!task.description && <Text style={styles.note}>{task.description}</Text>}
        <Text style={styles.meta}>
          {[
            `${task.progressPct}% selesai`,
            task.dueDate ? `target ${task.dueDate.slice(0, 10)}` : '',
          ].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      <Field label="Progres" hint="Kosongkan bila hanya menambah catatan.">
        {/* Discrete steps, never a slider: a slider held one-handed in a
            glove stops at 63% when the operator meant 60 (doc 03 §3.5). */}
        <Choice
          layout="steps"
          clearable
          value={progress}
          onChange={(v) => { setProgress(v); setError(''); }}
          accessibilityLabel="Progres pekerjaan"
          testID="task-progress"
          options={STEPS.map((value) => ({ value, label: `${value}%` }))}
        />
      </Field>

      <Field label="Status" hint="Kosongkan bila statusnya belum berubah.">
        <Choice
          layout="stack"
          clearable
          value={status}
          onChange={(v) => { setStatus(v); setError(''); }}
          accessibilityLabel="Status pekerjaan"
          testID="task-status"
          options={NEXT_STATUS.map((value) => ({
            value,
            label: STATUS_LABEL[value] ?? value,
            badge: task.status === value ? ' · sekarang' : undefined,
          }))}
        />
      </Field>

      <Field label="Catatan">
        <Input
          value={note}
          onChangeText={setNote}
          placeholder="mis. bearing sudah dilepas, menunggu spare part"
          multiline
        />
      </Field>

      <Field label="Foto bukti (opsional)">
        <PhotoThumb label={photo ? 'Terpasang' : 'Belum ada'} localUri={photo} size={140} />
        <Button
          title={photo ? 'Ambil ulang' : 'Ambil foto'}
          variant="secondary"
          onPress={() => router.push({
            pathname: '/camera',
            params: {
              returnTo: '/(tabs)/maintenance/tasks/[id]',
              id: String(task.id),
              label: 'Foto bukti pekerjaan',
              // Carried out and handed back, so the form survives the trip.
              draftStatus: status ?? '',
              draftProgress: progress === null ? '' : String(progress),
              draftNote: note,
            },
          })}
        />
      </Field>

      <Button
        title={busy ? 'Menyimpan…' : 'Simpan progres'}
        variant="primary"
        size="big"
        busy={busy}
        onPress={save}
      />

      <SectionTitle>Riwayat di HP ini</SectionTitle>

      {history.length === 0 ? (
        <EmptyInline>Belum ada progres yang tercatat di HP ini.</EmptyInline>
      ) : (
        history.map((entry) => (
          <Card key={entry.clientId}>
            <View style={styles.head}>
              <Text style={styles.title}>
                {[
                  entry.progressPct === null ? '' : `${entry.progressPct}%`,
                  entry.newStatus ? (STATUS_LABEL[entry.newStatus] ?? entry.newStatus) : '',
                ].filter(Boolean).join(' · ') || 'Catatan'}
              </Text>
              {entry.syncStatus !== 'SYNCED' && (
                <Text style={styles.unsent}>
                  {entry.syncStatus === 'SYNC_ERROR' ? 'Ditolak server' : 'Belum terkirim'}
                </Text>
              )}
            </View>

            {!!entry.note && <Text style={styles.note}>{entry.note}</Text>}

            {/* Said, not left as an absence. A record whose photo simply
                vanished looks identical to one where nobody took a photo, and
                the operator remembers taking it. */}
            {entry.photoLost && (
              <Text style={styles.photoLost}>Foto bukti hilang di HP sebelum sempat terkirim.</Text>
            )}

            {!!(entry.photoLocalUri || entry.photoPath) && (
              <View style={styles.photoRow}>
                <PhotoThumb
                  label="Bukti"
                  localUri={entry.photoLocalUri}
                  serverPath={entry.photoPath}
                  size={120}
                />
              </View>
            )}

            <Text style={styles.meta}>
              {[
                entry.operatorName,
                SHIFT_TIME_LABEL[entry.shiftTime] ?? entry.shiftTime,
                formatDateTime(entry.logTime),
              ].filter(Boolean).join(' · ')}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { ...type.bodyStrong, color: colors.text, flex: 1 },
  sub: { ...type.body, color: colors.muted, marginTop: 2 },
  note: { ...type.body, color: colors.text, marginTop: space.sm },
  meta: { ...type.body, color: colors.faint, marginTop: space.xs },
  unsent: { ...type.eyebrow, color: colors.warn, textTransform: 'uppercase' },
  photoRow: { flexDirection: 'row', marginTop: space.md },
  photoLost: { ...type.body, color: colors.warn, marginTop: space.sm },
});
