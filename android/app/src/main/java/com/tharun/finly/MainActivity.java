package com.tharun.finly;

import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** True once the person left Finly (Home, another app, Recents) while the screen was on. */
    private boolean leftApp = false;
    private BroadcastReceiver screenOff;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FinlySystemPlugin.class);
        super.onCreate(savedInstanceState);
        handleReminderTap(getIntent());
        // Switch the palette icon only once the screen turns off with Finly in the background.
        // Switching while Finly sits in Recents (or behind the contacts picker / share sheet) closes the app
        // and leaves a broken card in Recents, so it never happens while the phone is in use.
        screenOff = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (!leftApp || !finlyOnTop()) return;
                try { FinlySystemPlugin.applyPendingIcon(getApplicationContext()); } catch (Exception ignored) { }
            }
        };
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOff, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(screenOff, f);
        // re-arm reminders on every start (cheap), in case the phone dropped them
        try { ReminderReceiver.arm(getApplicationContext()); } catch (Exception ignored) { }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleReminderTap(intent);
    }

    private void handleReminderTap(Intent intent) {
        if (intent == null) return;
        String item = intent.getStringExtra("finlyItem"), plan = intent.getStringExtra("finlyPlan");
        if (item == null && plan == null) return;
        intent.removeExtra("finlyItem");
        intent.removeExtra("finlyPlan");
        FinlySystemPlugin.onReminderTap(item, plan);
    }

    @Override
    public void onStart() {
        super.onStart();
        leftApp = false;
    }

    @Override
    public void onStop() {
        super.onStop();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        // stopped because the screen turned off while Finly was open → not "left"; reopening must find it as it was
        leftApp = pm != null && pm.isInteractive() && !isChangingConfigurations();
    }

    /** False while Finly shows the contacts picker, share sheet or settings on top of itself. */
    private boolean finlyOnTop() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            for (ActivityManager.AppTask t : am.getAppTasks()) {
                ComponentName top = t.getTaskInfo().topActivity;
                if (top != null && !MainActivity.class.getName().equals(top.getClassName())) return false;
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onDestroy() {
        try { if (screenOff != null) unregisterReceiver(screenOff); } catch (Exception ignored) { }
        super.onDestroy();
    }
}
