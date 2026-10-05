package com.tharun.finly;

import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean visible = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FinlySystemPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
    }

    @Override
    public void onStop() {
        super.onStop();
        visible = false;
        // Switch the palette icon only after the person has really left Finly (Home / another app).
        // Not while Finly shows the contacts picker, share sheet or settings: those sit on top of Finly
        // in its own task, and switching then would close the app mid-way.
        handler.postDelayed(() -> {
            if (visible || isChangingConfigurations() || !finlyOnTop()) return;
            try { FinlySystemPlugin.applyPendingIcon(getApplicationContext()); } catch (Exception ignored) { }
        }, 1500);
    }

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
}
