package com.tharun.finly;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.app.Notification;

/** After Finly updates itself, reopen it (or, where Android blocks that, post a tap-to-open notification). */
public class UpdatedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { context.startActivity(open); } catch (Exception ignored) { }
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel("updates") == null) {
                nm.createNotificationChannel(new NotificationChannel("updates", "App updates", NotificationManager.IMPORTANCE_DEFAULT));
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(context, "updates") : new Notification.Builder(context);
            b.setSmallIcon(R.drawable.ic_stat_finly)
                .setContentTitle("Finly is updated")
                .setContentText("Tap to open the new version.")
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, 0, open, flags));
            nm.notify(900004, b.build());
        } catch (Exception ignored) { }
    }
}
