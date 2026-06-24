import { api } from '@/lib/api';

export async function sendNotification({
  userId,
  title,
  message,
  type = 'info',
  link,
}: {
  userId: string;
  title: string;
  message?: string;
  type?: string;
  link?: string;
}) {
  try {
    await api.notifications.create({
      user_id: userId,
      title,
      message: message || null,
      type,
      link: link || null,
    });
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}

export async function sendNotificationWithEmail({
  userId,
  title,
  message,
  type = 'info',
  link,
  leadName,
  assignedByName,
}: {
  userId: string;
  title: string;
  message?: string;
  type?: string;
  link?: string;
  leadName?: string;
  assignedByName?: string;
}) {
  // Send in-app notification via PHP API
  await sendNotification({ userId, title, message, type, link });

  // Email notifications can be handled server-side in PHP
  // The PHP notifications endpoint can trigger emails if configured
}
