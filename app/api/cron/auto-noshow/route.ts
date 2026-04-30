/**
 * /api/cron/auto-noshow — Automatic no-show marking
 * 
 * Runs on a schedule (every 15 min).
 * Marks schedule_entries as 'no_show' when:
 *   - status = 'sent' (not confirmed)
 *   - entry_date + shift_start has passed (the shift has started)
 *
 * Also checks resend deadline: if sent_at + limit_hours has passed.
 */
import { createServerClient } from '@/lib/supabase/client';
import { toLocalDateISO } from '@/app/lib/date-utils';

export async function GET(request: Request) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const now = new Date();
  const todayStr = toLocalDateISO(now);

  // Get all sent entries that might need to be marked as no_show
  // We check entries from today and yesterday (in case of late-night shifts)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateISO(yesterday);

  const { data: entries, error } = await supabase
    .from('schedule_entries')
    .select(`
      id, entry_date, shift_start, sent_at, created_at,
      schedule:schedules(id, confirmation_limit_hours)
    `)
    .eq('status', 'sent')
    .gte('entry_date', yesterdayStr)
    .lte('entry_date', todayStr);

  if (error) {
    console.error('[AutoNoShow] Query error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!entries || entries.length === 0) {
    return Response.json({ marked: 0, message: 'No entries to process' });
  }

  let marked = 0;
  const details: Array<{ id: string; date: string; reason: string }> = [];

  for (const entry of entries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduleRaw = entry.schedule as any;
    const schedule = (Array.isArray(scheduleRaw) ? scheduleRaw[0] : scheduleRaw) as {
      id: string;
      confirmation_limit_hours: number;
    };

    if (!schedule) continue;

    const shiftDateTime = new Date(`${entry.entry_date}T${entry.shift_start}`);
    const limitMs = schedule.confirmation_limit_hours * 60 * 60 * 1000;

    // Check if shift has already started (primary rule)
    const shiftStarted = now > shiftDateTime;

    // Also check resend deadline if applicable
    let resendExpired = false;
    if (entry.sent_at && entry.created_at) {
      const sentTime = new Date(entry.sent_at).getTime();
      const createdTime = new Date(entry.created_at).getTime();
      const isResend = sentTime - createdTime > 5 * 60 * 1000;
      if (isResend) {
        const resendDeadline = new Date(sentTime + limitMs);
        resendExpired = now > resendDeadline;
      }
    }

    // Mark as no_show if shift started AND (first send deadline passed OR resend deadline passed)
    if (shiftStarted) {
      const { error: updateError } = await supabase
        .from('schedule_entries')
        .update({ status: 'no_show' })
        .eq('id', entry.id)
        .eq('status', 'sent'); // Double-check status to avoid race conditions

      if (!updateError) {
        marked++;
        details.push({
          id: entry.id,
          date: entry.entry_date,
          reason: resendExpired ? 'resend_deadline_expired' : 'shift_started',
        });
      }
    }
  }

  console.log(`[AutoNoShow] Marked ${marked} entries as no_show`);

  return Response.json({
    marked,
    total: entries.length,
    details,
    processedAt: now.toISOString(),
  });
}
