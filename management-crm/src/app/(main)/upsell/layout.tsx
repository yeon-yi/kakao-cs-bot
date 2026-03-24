'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const ALLOWED_ROLES = ['upselling_director', 'upselling_chief', 'upselling_staff', 'admin'];

export default function UpsellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch('/api/auth')
      .then((r) => {
        if (!r.ok) throw new Error('Unauthorized');
        return r.json();
      })
      .then((data) => {
        if (!ALLOWED_ROLES.includes(data.user?.role)) {
          router.replace('/dashboard');
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  if (!authorized) return null;
  return <>{children}</>;
}
