package com.homeorbit.family;

import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.util.Locale;

@CapacitorPlugin(name = "HomeOrbitServer")
public class HomeOrbitServerPlugin extends Plugin {

    static final String PREFERENCES = "homeorbit_mobile";
    static final String SERVER_KEY = "server_url";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, android.content.Context.MODE_PRIVATE);
    }

    private String normalized(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty() || value.matches(".*\\s.*")) return null;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("https") && !scheme.equals("http")) return null;
            if (uri.getHost() == null || uri.getUserInfo() != null) return null;
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (!path.isEmpty() && !path.equals("/")) return null;
            if (uri.getQuery() != null || uri.getFragment() != null) return null;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
            int port = uri.getPort();
            return scheme + "://" + host + (port > 0 ? ":" + port : "");
        } catch (Exception error) {
            return null;
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("url", preferences().getString(SERVER_KEY, null));
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String server = normalized(call.getString("url"));
        if (server == null) {
            call.reject("Enter a valid http(s) HomeOrbit root address without a path.");
            return;
        }
        preferences().edit().putString(SERVER_KEY, server).apply();
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        preferences().edit().remove(SERVER_KEY).apply();
        call.resolve();
    }

    @PluginMethod
    public void reload(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }
}
