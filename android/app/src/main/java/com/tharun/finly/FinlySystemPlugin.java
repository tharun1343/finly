package com.tharun.finly;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.pm.PackageInstaller;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileOutputStream;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.ContactsContract;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Small Android helpers Finly needs that no stock plugin covers:
 * battery-optimisation exemption, "install unknown apps" for in-app updates,
 * picking a contact with all of its numbers, and switching the launcher icon.
 */
@CapacitorPlugin(
    name = "FinlySystem",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class FinlySystemPlugin extends Plugin {

    /** The live plugin, so the install-result receiver can report back to the app. */
    static FinlySystemPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void reportInstall(String status, String message) {
        FinlySystemPlugin p = instance;
        if (p == null) return;
        JSObject ev = new JSObject();
        ev.put("status", status);
        ev.put("message", message == null ? "" : message);
        p.notifyListeners("installResult", ev);
    }

    /** Launcher icon variants, one activity-alias per palette (see AndroidManifest.xml). */
    private static final String[] ICONS = {
        "sapphire", "violet", "berry", "ruby", "terracotta", "amber", "mocha", "sage", "teal", "mono", "pitch"
    };

    /* ---------- battery ---------- */

    private boolean ignoringBattery() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("unrestricted", ignoringBattery());
        call.resolve(r);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (ignoringBattery()) {
            batteryStatus(call);
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, i, "batteryResult");
        } catch (Exception e) {
            try {
                startActivityForResult(call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), "batteryResult");
            } catch (Exception e2) {
                batteryStatus(call);
            }
        }
    }

    @ActivityCallback
    private void batteryResult(PluginCall call, ActivityResult result) {
        if (call != null) batteryStatus(call);
    }

    /* ---------- installing updates ---------- */

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void installStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", canInstall());
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (canInstall()) {
            installStatus(call);
            return;
        }
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, i, "installResult");
    }

    @ActivityCallback
    private void installResult(PluginCall call, ActivityResult result) {
        if (call != null) installStatus(call);
    }

    /**
     * Installs a downloaded update of Finly itself through PackageInstaller.
     * On Android 12+ an app updating itself needs no confirmation (USER_ACTION_NOT_REQUIRED);
     * older versions show Android's confirm screen. Emits "installProgress" { progress } while copying.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("No file");
            return;
        }
        new Thread(() -> {
            PackageInstaller.Session session = null;
            try {
                File f = new File(path.startsWith("file:") ? Uri.parse(path).getPath() : path);
                long total = f.length();
                PackageInstaller pi = getContext().getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(getContext().getPackageName());
                params.setSize(total);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) params.setInstallReason(PackageManager.INSTALL_REASON_USER);
                int id = pi.createSession(params);
                session = pi.openSession(id);
                InputStream in = new FileInputStream(f);
                OutputStream out = session.openWrite("finly.apk", 0, total);
                byte[] buf = new byte[1 << 16];
                long done = 0;
                int n, last = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    int pct = (int) (done * 100 / Math.max(1, total));
                    if (pct != last) {
                        last = pct;
                        JSObject ev = new JSObject();
                        ev.put("progress", done / (double) Math.max(1, total));
                        notifyListeners("installProgress", ev);
                    }
                }
                session.fsync(out);
                out.close();
                in.close();
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                Intent result = new Intent(getContext(), InstallResultReceiver.class);
                PendingIntent pending = PendingIntent.getBroadcast(getContext(), id, result, flags);
                session.commit(pending.getIntentSender());
                session.close();
                JSObject r = new JSObject();
                r.put("started", true);
                call.resolve(r);
            } catch (Exception e) {
                if (session != null) session.abandon();
                call.reject("Install failed: " + e.getMessage(), "INSTALL");
            }
        }).start();
    }

    /** What could stop reminders from arriving on time. */
    @PluginMethod
    public void reliabilityStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("unrestricted", ignoringBattery());
        boolean bgRestricted = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            bgRestricted = am != null && am.isBackgroundRestricted();
        }
        r.put("backgroundRestricted", bgRestricted);
        boolean exact = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarm = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            exact = alarm == null || alarm.canScheduleExactAlarms();
        }
        r.put("exactAlarms", exact);
        r.put("maker", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        call.resolve(r);
    }

    /** Opens Finly's page in Android Settings (battery, autostart, notifications live there). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, i, "settingsResult");
    }

    /** Opens Finly's notification settings. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        startActivityForResult(call, i, "settingsResult");
    }

    @ActivityCallback
    private void settingsResult(PluginCall call, ActivityResult result) {
        if (call != null) reliabilityStatus(call);
    }

    /* ---------- gallery ---------- */

    /** Saves a PNG (base64) straight into the phone's gallery under Pictures/Finly. */
    @PluginMethod
    public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermResult");
            return;
        }
        writeImage(call);
    }

    @PermissionCallback
    private void storagePermResult(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) writeImage(call);
        else call.reject("Storage permission denied", "DENIED");
    }

    private void writeImage(PluginCall call) {
        String data = call.getString("base64"), name = call.getString("name", "finly.png");
        if (data == null) {
            call.reject("No image");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Finly");
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("Gallery unavailable");
                try (OutputStream out = cr.openOutputStream(uri)) { out.write(bytes); }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Finly");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                try (OutputStream out = new FileOutputStream(f)) { out.write(bytes); }
                MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, new String[] { "image/png" }, null);
            }
            JSObject r = new JSObject();
            r.put("saved", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Couldn't save: " + e.getMessage(), "SAVE");
        }
    }

    /* ---------- contacts ---------- */

    @PluginMethod
    public void pickContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermResult");
            return;
        }
        launchPicker(call);
    }

    @PermissionCallback
    private void contactsPermResult(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) launchPicker(call);
        else call.reject("Contacts permission denied", "DENIED");
    }

    private void launchPicker(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
        startActivityForResult(call, i, "contactResult");
    }

    @ActivityCallback
    private void contactResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        String id = null, name = "";
        try (Cursor c = getContext().getContentResolver().query(data.getData(),
                new String[] { ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                id = c.getString(0);
                name = c.getString(1) == null ? "" : c.getString(1);
            }
        } catch (Exception e) {
            call.reject("Couldn't read the contact", "READ");
            return;
        }
        JSArray phones = new JSArray();
        if (id != null) {
            try (Cursor p = getContext().getContentResolver().query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[] { ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.TYPE,
                        ContactsContract.CommonDataKinds.Phone.LABEL, ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY },
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?", new String[] { id }, null)) {
                while (p != null && p.moveToNext()) {
                    JSObject ph = new JSObject();
                    ph.put("number", p.getString(0));
                    CharSequence label = ContactsContract.CommonDataKinds.Phone.getTypeLabel(getContext().getResources(), p.getInt(1), p.getString(2));
                    ph.put("label", label == null ? "" : label.toString());
                    ph.put("primary", p.getInt(3) != 0);
                    phones.put(ph);
                }
            } catch (Exception e) {
                // name alone is still useful
            }
        }
        JSObject r = new JSObject();
        r.put("name", name);
        r.put("phones", phones);
        call.resolve(r);
    }

    /* ---------- launcher icon ---------- */

    /**
     * Remembers which launcher icon to use. Switching the icon disables the launcher entry the app was opened
     * from, and Android then closes the app and drops it from Recents — so the switch is applied only once
     * the person leaves Finly (MainActivity.onStop), never while it's on screen.
     */
    @PluginMethod
    public void setLauncherIcon(PluginCall call) {
        String want = known(call.getString("name", "sapphire"));
        getContext().getSharedPreferences("finly", Context.MODE_PRIVATE).edit().putString("pendingIcon", want).apply();
        JSObject r = new JSObject();
        r.put("name", want);
        r.put("pending", !want.equals(currentIcon(getContext())));
        call.resolve(r);
    }

    private static String known(String want) {
        for (String n : ICONS) if (n.equals(want)) return want;
        return "sapphire";
    }

    static String currentIcon(Context ctx) {
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        for (String n : ICONS) {
            int s = pm.getComponentEnabledSetting(new ComponentName(pkg, pkg + ".Icon_" + n));
            if (s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (s == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && n.equals("sapphire"))) return n;
        }
        return "sapphire";
    }

    /** Applies a pending icon switch. Called when Finly goes to the background. */
    static void applyPendingIcon(Context ctx) {
        android.content.SharedPreferences prefs = ctx.getSharedPreferences("finly", Context.MODE_PRIVATE);
        String want = prefs.getString("pendingIcon", null);
        if (want == null) return;
        prefs.edit().remove("pendingIcon").apply();
        if (want.equals(currentIcon(ctx))) return;
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        // enable the new entry before disabling the others, so the home screen never has no Finly icon
        pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + ".Icon_" + want), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        for (String n : ICONS) {
            if (n.equals(want)) continue;
            ComponentName cn = new ComponentName(pkg, pkg + ".Icon_" + n);
            if (pm.getComponentEnabledSetting(cn) == PackageManager.COMPONENT_ENABLED_STATE_DISABLED) continue;
            pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
    }

    @PluginMethod
    public void getLauncherIcon(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName(), current = "sapphire";
        for (String n : ICONS) {
            int s = pm.getComponentEnabledSetting(new ComponentName(pkg, pkg + ".Icon_" + n));
            boolean on = s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                || (s == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && n.equals("sapphire"));
            if (on) { current = n; break; }
        }
        JSObject r = new JSObject();
        r.put("name", current);
        call.resolve(r);
    }

    /* ---------- device ---------- */

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject r = new JSObject();
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "" : Build.MODEL;
        r.put("name", model.toLowerCase().startsWith(maker.toLowerCase()) ? model : (capitalize(maker) + " " + model).trim());
        r.put("os", "Android " + Build.VERSION.RELEASE);
        call.resolve(r);
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
