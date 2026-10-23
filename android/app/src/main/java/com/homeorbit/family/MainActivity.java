package com.homeorbit.family;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import java.net.URI;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        if (isSetupIntent(getIntent())) {
            clearSavedServer();
            getIntent().setData(null);
        }
        registerPlugin(HomeOrbitServerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isSetupIntent(intent)) {
            clearSavedServer();
            intent.setData(null);
            recreate();
        }
    }

    private boolean isSetupIntent(Intent intent) {
        if (intent == null) return false;
        Uri data = intent.getData();
        return data != null && "homeorbit".equals(data.getScheme()) && "setup".equals(data.getHost());
    }

    private void clearSavedServer() {
        getSharedPreferences(HomeOrbitServerPlugin.PREFERENCES, MODE_PRIVATE)
            .edit()
            .remove(HomeOrbitServerPlugin.SERVER_KEY)
            .commit();
    }

    @Override
    protected void load() {
        SharedPreferences preferences = getSharedPreferences(HomeOrbitServerPlugin.PREFERENCES, MODE_PRIVATE);
        String serverUrl = preferences.getString(HomeOrbitServerPlugin.SERVER_KEY, null);
        if (serverUrl != null && !serverUrl.trim().isEmpty()) {
            boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            CapConfig.Builder builder = new CapConfig.Builder(this)
                .setServerUrl(serverUrl)
                .setErrorPath("offline.html")
                .setBackgroundColor("#f6f2ea")
                .setInitialFocus(true)
                .setLoggingEnabled(debuggable);
            try {
                URI uri = URI.create(serverUrl);
                if (uri.getHost() != null) {
                    builder.setAllowNavigation(new String[] { uri.getHost() });
                }
            } catch (Exception ignored) {
                // The stored URL is validated by HomeOrbitServerPlugin before saving.
            }
            this.config = builder.create();
        }
        super.load();
    }
}
