package com.tharun.finly;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Finly's own reminder engine. The app hands over every reminder slot (setReminders); they are kept in
 * SharedPreferences and armed as exact alarms, so they fire with Finly closed. Alarms are armed again after a
 * reboot, an app update, a clock change, and by a watchdog alarm every few hours — and a slot whose alarm was
 * lost (some phones clear alarms when the app is swiped away) is still shown late rather than never.
 */
public class ReminderReceiver extends BroadcastReceiver {
    static final String FIRE = "com.tharun.finly.REMINDER_FIRE";
    static final String CHECK = "com.tharun.finly.REMINDER_CHECK";
    static final String CHANNEL = "reminders";
    private static final String PREFS = "finly_reminders";
    private static final long DAY = 86400000L;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (FIRE.equals(a)) {
            String key = intent.getStringExtra("key");
            if (key != null) fire(ctx, key, false);
        }
        // BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED, the watchdog — and after each fire
        arm(ctx);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Replaces one group of slots ("reminders" or "plan") and re-arms everything. */
    static void setGroup(Context ctx, String group, JSONArray list) {
        prefs(ctx).edit().putString("group_" + group, list.toString()).apply();
        arm(ctx);
    }

    private static JSONArray all(Context ctx) {
        JSONArray out = new JSONArray();
        for (Map.Entry<String, ?> e : prefs(ctx).getAll().entrySet()) {
            if (!e.getKey().startsWith("group_")) continue;
            try {
                JSONArray g = new JSONArray(String.valueOf(e.getValue()));
                for (int i = 0; i < g.length(); i++) out.put(g.getJSONObject(i));
            } catch (Exception ignored) { }
        }
        return out;
    }

    private static JSONObject map(Context ctx, String name) {
        try { return new JSONObject(prefs(ctx).getString(name, "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    private static int code(String key) {
        return 0x3F000000 ^ (key.hashCode() & 0x00FFFFFF);
    }

    private static PendingIntent fireIntent(Context ctx, String key, int extraFlags) {
        Intent i = new Intent(ctx, ReminderReceiver.class).setAction(FIRE).putExtra("key", key);
        int flags = extraFlags | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(ctx, code(key), i, flags);
    }

    /** Arms every future slot, shows slots whose alarm was lost, and keeps the watchdog running. */
    static synchronized void arm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long now = System.currentTimeMillis();
        JSONArray list = all(ctx);
        JSONObject fired = map(ctx, "fired"), armed = map(ctx, "armed"), nextArmed = new JSONObject();
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        Map<String, JSONObject> missedByItem = new HashMap<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject r = list.optJSONObject(i);
            if (r == null) continue;
            String key = r.optString("key");
            long at = r.optLong("at"), until = r.optLong("until", at + DAY);
            if (key.isEmpty() || fired.has(key) || until < now) continue;
            if (at > now + 3000) {
                PendingIntent pi = fireIntent(ctx, key, PendingIntent.FLAG_UPDATE_CURRENT);
                try {
                    if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                    else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } catch (SecurityException se) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
                try { nextArmed.put(key, at); } catch (Exception ignored) { }
            } else if (armed.has(key) || sameDay(at, now) || r.optBoolean("soon")) {
                // its time has come but it never showed (alarm lost, or added after today's 9 AM): show it now,
                // just the latest one per payment
                JSONObject prev = missedByItem.get(r.optString("item"));
                if (prev == null || prev.optLong("at") < at) missedByItem.put(r.optString("item"), r);
            } else {
                try { fired.put(key, now); } catch (Exception ignored) { }   // too old to be useful
            }
        }
        // cancel alarms for slots that no longer exist (paid, deleted, changed)
        for (Iterator<String> it = armed.keys(); it.hasNext(); ) {
            String key = it.next();
            if (nextArmed.has(key)) continue;
            PendingIntent pi = fireIntent(ctx, key, PendingIntent.FLAG_NO_CREATE);
            if (pi != null) { am.cancel(pi); pi.cancel(); }
        }
        prefs(ctx).edit().putString("armed", nextArmed.toString()).putString("fired", prune(fired, now).toString()).apply();
        for (JSONObject r : missedByItem.values()) fire(ctx, r.optString("key"), true);
        armWatchdog(ctx, am, list.length() > 0);
    }

    private static JSONObject prune(JSONObject m, long now) {
        JSONObject out = new JSONObject();
        for (Iterator<String> it = m.keys(); it.hasNext(); ) {
            String k = it.next();
            long t = m.optLong(k);
            if (now - t < 60 * DAY) try { out.put(k, t); } catch (Exception ignored) { }
        }
        return out;
    }

    private static boolean sameDay(long a, long b) {
        Calendar x = Calendar.getInstance(), y = Calendar.getInstance();
        x.setTimeInMillis(a);
        y.setTimeInMillis(b);
        return x.get(Calendar.YEAR) == y.get(Calendar.YEAR) && x.get(Calendar.DAY_OF_YEAR) == y.get(Calendar.DAY_OF_YEAR);
    }

    /** Every ~3 hours: re-arm and catch up, in case the phone dropped alarms. */
    private static void armWatchdog(Context ctx, AlarmManager am, boolean on) {
        Intent i = new Intent(ctx, ReminderReceiver.class).setAction(CHECK);
        int f = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0x3E000001, i, f | PendingIntent.FLAG_UPDATE_CURRENT);
        if (!on) { am.cancel(pi); return; }
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 3 * 3600000L, 3 * 3600000L, pi);
    }

    /** Posts one slot's notification (once). */
    static synchronized void fire(Context ctx, String key, boolean late) {
        JSONObject fired = map(ctx, "fired");
        if (fired.has(key)) return;
        JSONObject r = null;
        JSONArray list = all(ctx);
        for (int i = 0; i < list.length(); i++) {
            JSONObject x = list.optJSONObject(i);
            if (x != null && key.equals(x.optString("key"))) { r = x; break; }
        }
        try { fired.put(key, System.currentTimeMillis()); } catch (Exception ignored) { }
        prefs(ctx).edit().putString("fired", fired.toString()).apply();
        if (r == null) return;
        long now = System.currentTimeMillis();
        if (r.optLong("until", now) < now) return;
        post(ctx, r.optInt("nid", 1), title(r, now), r.optString("body"), r.optString("item"), r.optString("plan"));
    }

    /** "Due today / tomorrow / in 3 days", worked out when it is shown (a late reminder must not say "in 3 days"). */
    private static String title(JSONObject r, long now) {
        String t = r.optString("title");
        long due = r.optLong("due", 0);
        if (due <= 0 || !t.contains("{when}")) return t.replace("{when}", "soon");
        Calendar a = Calendar.getInstance(), b = Calendar.getInstance();
        a.setTimeInMillis(now);
        b.setTimeInMillis(due);
        for (Calendar c : new Calendar[] { a, b }) { c.set(Calendar.HOUR_OF_DAY, 12); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0); }
        long d = Math.round((b.getTimeInMillis() - a.getTimeInMillis()) / (double) DAY);
        String when = d <= 0 ? "today" : d == 1 ? "tomorrow" : "in " + d + " days";
        return t.replace("{when}", when);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Payment reminders", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Reminders before EMIs, bills and chit rounds are due");
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    static void post(Context ctx, int nid, String title, String body, String item, String plan) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            ensureChannel(ctx);
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (item != null && !item.isEmpty()) open.putExtra("finlyItem", item);
            if (plan != null && !plan.isEmpty()) open.putExtra("finlyPlan", plan);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
            b.setSmallIcon(R.drawable.ic_stat_finly)
                .setColor(Color.parseColor("#7C9BFF"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(PendingIntent.getActivity(ctx, 0x3D000000 ^ (nid & 0xFFFF), open, flags));
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
            nm.notify(0x3C000000 ^ (nid & 0xFFFF), b.build());
        } catch (Exception ignored) { }
    }

    /** For the "Send a test" button: the same alarm path as real reminders. */
    static void test(Context ctx, long delayMs) {
        try {
            JSONArray g = new JSONArray();
            JSONObject r = new JSONObject();
            long at = System.currentTimeMillis() + delayMs;
            r.put("key", "test|" + at);
            r.put("at", at);
            r.put("until", at + DAY);
            r.put("nid", 900);
            r.put("title", "Finly reminders are working");
            r.put("body", "This came through the same alarm as your payment reminders — even with Finly closed.");
            g.put(r);
            setGroup(ctx, "test", g);
        } catch (Exception ignored) { }
    }
}
