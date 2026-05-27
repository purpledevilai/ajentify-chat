import { useState } from 'react';
import { useDoPageAction, useGetPageData } from '@ajentify/chat';

export function ProfilePage() {
  const [name, setName] = useState('Acme User');
  const [email, setEmail] = useState('user@acme.example');
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
    <div className="page">
      <h1>Profile</h1>
      <div className="card">
        <h2>About you</h2>
        <p>
          <strong>Name:</strong> {name}
        </p>
        <p>
          <strong>Email:</strong> {email}
        </p>
        <p>
          <strong>Bio:</strong> {bio}
        </p>
        <p style={{ fontSize: 13, opacity: 0.6, marginTop: 16 }}>
          Tip: open the chat and ask <em>"update my bio to anything you like"</em>.
        </p>
      </div>
    </div>
  );
}
