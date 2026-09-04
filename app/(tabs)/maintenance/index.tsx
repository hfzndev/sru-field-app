import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, Empty, Heading, Loading, Screen, Toast } from '@/components/ui';
import { STATUS_LABEL, TOUCH_TARGET, colors, radius, space, type } from '@/constants/theme';
import { relative } from '@/lib/format';
import { EquipmentRow, TaskRow, listEquipment, listTasks } from '@/lib/queue';

/**
 * Maintenance: the plant's equipment and the tasks open against it (doc 03 §3.5).
 *
 * Two segments rather than two tabs. Six bottom tabs do not fit a phone bar at
 * a 16pt label, and these two are the same question asked twice — what is
 * broken, and what is being done about it.
 *
 * Equipment is ordered by severity rather than tag number, which is the whole
 * design of that half: an operator opening this mid-shift is asking "what is
 * broken", not "where is P-9101 in the alphabet". Anything not NORMAL sits at
 * the top and carries the reason it is there.
 */
const SEVERITY: Record<string, number> = {
  NEED_REPAIR: 0,
  ON_REPAIR: 1,
  STANDBY: 2,
  NORMAL: 3,
};

type Segment = 'ALAT' | 'TASK';

export default function MaintenanceScreen() {
  const { saved } = useLocalSearchParams<{ saved?: string }>();
  const [segment, setSegment] = useState<Segment>('ALAT');
  const [equipment, setEquipment] = useState<EquipmentRow[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [toast, setToast] = useState<string | null>(saved ?? null);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const [rows, taskRows] = await Promise.all([listEquipment(), listTasks()]);
      if (ignore) return;
      setEquipment([...rows].sort((a, b) =>
        (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9)
        || a.tagNumber.localeCompare(b.tagNumber)));
      setTasks(taskRows);
    })();
    return () => { ignore = true; };
  }, []));

  const attention = (equipment ?? []).filter((e) => e.status !== 'NORMAL').length;

  return (
    <Screen>
      <Toast message={toast} onDone={() => setToast(null)} />

      <Heading sub="Status alat dan pekerjaan yang sedang berjalan.">
        Servis
      </Heading>

      <View style={styles.segments}>
        {(['ALAT', 'TASK'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: segment === value }}
            onPress={() => setSegment(value)}
            style={[styles.segment, segment === value && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, segment === value && styles.segmentTextOn]}>
              {value === 'ALAT' ? 'Alat' : 'Task'}
              {value === 'ALAT' && attention > 0 ? ` · ${attention}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {segment === 'ALAT'
        ? <EquipmentList rows={equipment} attention={attention} />
        : <TaskList rows={tasks} />}
    </Screen>
  );
}

function EquipmentList({ rows, attention }: { rows: EquipmentRow[] | null; attention: number }) {
  if (rows === null) return <Loading />;
  if (rows.length === 0) {
    return (
      <Empty
        icon="🔧"
        title="Belum ada data peralatan"
        hint="Daftar alat datang dari server. Sync sekali saat ada sinyal."
      />
    );
  }

  return (
    <>
      {attention > 0 && (
        <Text style={styles.attention}>{attention} alat tidak normal.</Text>
      )}

      {rows.map((item) => (
        <Card key={item.id} onPress={() => router.push({
          pathname: '/(tabs)/maintenance/equipment/[id]',
          params: { id: String(item.id) },
        })}>
          <View style={styles.head}>
            <View style={styles.headText}>
              {/* Tag in full, never abbreviated (doc 02 §1.1). */}
              <Text style={styles.tag}>{item.tagNumber}</Text>
              <Text style={styles.sub}>
                {[item.name, item.location].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Chip value={item.status} />
          </View>

          {!!item.statusNote && (
            <Text style={styles.note} numberOfLines={2}>{item.statusNote}</Text>
          )}

          {/* Rendered only when there is something to say — an empty Text still
              takes a line, and a blank strip under every healthy pump makes the
              list harder to scan. */}
          {!!(item.statusChangedBy || item.statusChangedAt) && (
            <Text style={styles.meta}>
              {[
                item.statusChangedBy,
                item.statusChangedAt ? relative(item.statusChangedAt) : '',
              ].filter(Boolean).join(' · ')}
            </Text>
          )}

          {/* The operator's own unsent report, shown as such. Hiding it would
              look like the app had dropped what they just recorded. */}
          {item.pendingStatus && (
            <Text style={styles.unsent}>
              Belum terkirim · {STATUS_LABEL[item.pendingStatus] ?? item.pendingStatus}
            </Text>
          )}
        </Card>
      ))}
    </>
  );
}

/**
 * Open tasks, read-only for now.
 *
 * Cards are deliberately not pressable yet: recording progress arrives with the
 * task form, and a card that responds to nothing teaches operators that parts
 * of this app do not work.
 */
function TaskList({ rows }: { rows: TaskRow[] | null }) {
  if (rows === null) return <Loading />;
  if (rows.length === 0) {
    return (
      <Empty
        icon="🗂️"
        title="Tidak ada task terbuka"
        hint="Task dibuat admin dan turun ke HP saat sync."
      />
    );
  }

  return (
    <>
      {rows.map((task) => (
        <Card key={task.id}>
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.tag}>{task.title}</Text>
              <Text style={styles.sub}>
                {[task.equipmentTag, task.equipmentName].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Chip value={task.status} />
          </View>

          {!!task.description && (
            <Text style={styles.note} numberOfLines={3}>{task.description}</Text>
          )}

          <Text style={styles.meta}>
            {[
              `${task.progressPct}% selesai`,
              task.dueDate ? `target ${task.dueDate.slice(0, 10)}` : '',
            ].filter(Boolean).join(' · ')}
          </Text>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  segmentText: { ...type.bodyStrong, color: colors.muted },
  segmentTextOn: { color: colors.accent },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  headText: { flex: 1 },
  tag: { ...type.bodyStrong, color: colors.text },
  sub: { ...type.caption, color: colors.muted, marginTop: 2 },
  note: { ...type.body, color: colors.text, marginTop: space.sm },
  meta: { ...type.caption, color: colors.faint, marginTop: 2 },
  attention: { ...type.body, color: colors.warn, marginTop: space.md },
  unsent: { ...type.caption, color: colors.warn, marginTop: space.sm },
});
