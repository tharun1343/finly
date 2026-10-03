package com.tharun.finly;

import android.Manifest;
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
    permissions = { @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }) }
)
public class FinlySystemPlugin extends Plugin {

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

    @PluginMethod
    public void setLauncherIcon(PluginCall call) {
        String want = call.getString("name", "sapphire");
        boolean known = false;
        for (String n : ICONS) if (n.equals(want)) known = true;
        if (!known) want = "sapphire";
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        // Enable the new one first so there is never a moment without a launcher entry.
        pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + ".Icon_" + want),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        for (String n : ICONS) {
            if (n.equals(want)) continue;
            pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + ".Icon_" + n),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
        JSObject r = new JSObject();
        r.put("name", want);
        call.resolve(r);
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
