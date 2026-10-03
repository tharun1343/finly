package com.tharun.finly;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** Gets the outcome of an in-app update. Shows Android's confirm screen when the system still asks for it. */
public class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { context.startActivity(confirm); } catch (Exception ignored) { }
            }
            FinlySystemPlugin.reportInstall("confirm", msg);
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            FinlySystemPlugin.reportInstall("success", msg);
        } else {
            FinlySystemPlugin.reportInstall("failed", msg);
        }
    }
}
