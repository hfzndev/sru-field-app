import { Stack, router } from 'expo-router';
import { Button, Empty, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Halaman tidak ada' }} />
      <Screen>
        <Empty
          icon="🧭"
          title="Halaman tidak ditemukan"
          hint="Kembali ke beranda dan coba lagi."
        />
        <Button title="Ke beranda" variant="primary" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    </>
  );
}
