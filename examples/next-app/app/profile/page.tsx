'use client';

import { useState } from 'react';
import { useDoPageAction, useGetPageData } from '@ajentify/chat';

export default function ProfilePage() {
  const [name, setName] = useState('Next User');
  const [email, setEmail] = useState('user@next.example');
  const [bio, setBio] = useState('Operations lead.');

  useGetPageData(
    () => ({
      data: { page: 'profile', name, email, bio },
      actions: {
        update_profile: {
          description: 'Update profile fields on the page.',
          argsSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              bio: { type: 'string' },
            },
          },
        },
      },
    }),
    [name, email, bio]
  );

  useDoPageAction(
    async (key, args) => {
      if (key === 'update_profile') {
        if (typeof args.name === 'string') setName(args.name);
        if (typeof args.email === 'string') setEmail(args.email);
        if (typeof args.bio === 'string') setBio(args.bio);
        return { ok: true };
      }
      return { ok: false, error: `unknown action: ${key}` };
    },
    []
  );

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Profile</h1>
      <div className="mb-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">About you</h2>
        <p>
          <strong>Name:</strong> {name}
        </p>
        <p>
          <strong>Email:</strong> {email}
        </p>
        <p>
          <strong>Bio:</strong> {bio}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Tip: open the chat and ask <em>&ldquo;update my bio to anything you like&rdquo;</em>.
        </p>
      </div>
    </div>
  );
}
