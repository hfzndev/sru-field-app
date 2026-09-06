import { Stack, router } from 'expo-router';
import { ICON } from '@/components/icon';
import { Button, Empty, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Halaman tidak ada' }} />
      <Screen>
        <Empty
          icon={ICON.emptyRoute}
          title="Halaman tidak ditemukan"
          hint="Kembali ke beranda dan coba lagi."
        />
        <Button title="Ke beranda" variant="primary" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    </>
  );
}
