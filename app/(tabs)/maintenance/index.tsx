import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { ICON } from '@/components/icon';
import {
  Empty, Heading, ListGroup, ListRow, Loading, Screen, Toast, UnsentMark,
} from '@/components/ui';
import { STATUS_LABEL, colors, space, type } from '@/constants/theme';
import { relative } from '@/lib/format';
import { EquipmentRow, TaskRow, listEquipment, listTasks } from '@/lib/queue';
import { sortBySeverity } from '@/lib/severity';

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
      setEquipment(sortBySeverity(rows));
      setTasks(taskRows);
    })();
    return () => { ignore = true; };
  }, []));

  const attention = (equipment ?? []).filter((e) => e.status !== 'NORMAL').length;

  return (
    <Screen>
      <Toast message={toast} onDone={() => setToast(null)} />

      <Heading sub="Status alat dan pekerjaan yang sedang berjalan.">
        Status Peralatan
      </Heading>

      <View style={styles.segments}>
        <Choice
          layout="segments"
          value={segment}
          onChange={(v) => setSegment((v ?? segment) as Segment)}
          accessibilityLabel="Alat atau task"
          testID="maintenance-segment"
          options={[
            { value: 'ALAT', label: 'Alat', badge: attention > 0 ? ` · ${attention}` : undefined },
            { value: 'TASK', label: 'Task' },
          ]}
        />
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
        icon={ICON.service}
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

      {/* The rail is what makes the worst-first sort readable at arm's length:
          the top of this list is a block of red before any word resolves. */}
      <ListGroup>
        {rows.map((item) => (
          <ListRow
            key={item.id}
            status={item.status}
            title={item.tagNumber}
            titleNumeric
            subtitle={[item.name, item.location].filter(Boolean).join(' · ') || undefined}
            meta={[
              item.statusChangedBy,
              item.statusChangedAt ? relative(item.statusChangedAt) : '',
            ].filter(Boolean).join(' · ') || undefined}
            footer={
              <>
                {!!item.statusNote && (
                  <Text style={styles.note} numberOfLines={2}>{item.statusNote}</Text>
                )}
                {item.pendingStatus ? (
                  <UnsentMark
                    status="PENDING_SYNC"
                    detail={STATUS_LABEL[item.pendingStatus] ?? item.pendingStatus}
                  />
                ) : null}
              </>
            }
            onPress={() => router.push({
              pathname: '/(tabs)/maintenance/equipment/[id]',
              params: { id: String(item.id) },
            })}
          />
        ))}
      </ListGroup>
    </>
  );
}

/**
 * Open tasks, unfinished first.
 *
 * Tapping one opens the place progress is reported. Tasks themselves are
 * read-only on the phone: they are created by an admin and travel down with the
 * pull (doc 07 §7). What the operator adds is progress.
 */
function TaskList({ rows }: { rows: TaskRow[] | null }) {
  if (rows === null) return <Loading />;
  if (rows.length === 0) {
    return (
      <Empty
        icon={ICON.emptyTask}
        title="Tidak ada task terbuka"
        hint="Task dibuat admin dan turun ke HP saat sync."
      />
    );
  }

  return (
    <>
      <ListGroup>
        {rows.map((task) => (
          <ListRow
            key={task.id}
            status={task.status}
            title={task.title}
            subtitle={[task.equipmentTag, task.equipmentName].filter(Boolean).join(' · ') || undefined}
            meta={[
              `${task.progressPct}% selesai`,
              task.dueDate ? `target ${task.dueDate.slice(0, 10)}` : '',
            ].filter(Boolean).join(' · ')}
            footer={!!task.description && (
              <Text style={styles.note} numberOfLines={3}>{task.description}</Text>
            )}
            onPress={() => router.push({
              pathname: '/(tabs)/maintenance/tasks/[id]',
              params: { id: String(task.id) },
            })}
          />
        ))}
      </ListGroup>
    </>
  );
}

const styles = StyleSheet.create({
  segments: { marginTop: space.md, marginBottom: space.sm },
  note: { ...type.body, color: colors.text, marginTop: space.xs },
  attention: { ...type.bodyStrong, color: colors.warn, marginTop: space.md, marginBottom: space.sm },
});
