import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.homeorbit.family",
  appName: "HomeOrbit",
  webDir: "mobile/www",
  backgroundColor: "#f6f2ea",
  server: {
    errorPath: "offline.html",
    androidScheme: "https",
    iosScheme: "https",
  },
  android: {
    backgroundColor: "#f6f2ea",
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#f6f2ea",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#0b4f49",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#f6f2ea",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
