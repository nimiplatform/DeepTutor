package ai.nimi.apps.deeptutor.dev;

import com.getcapacitor.BridgeActivity;
import android.widget.TextView;
import android.view.ViewGroup;
import androidx.webkit.WebViewFeature;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText("Update Android System WebView to use DeepTutor. A bridge restricted to the main frame and approved origin is required.");
            message.setPadding(32, 64, 32, 32);
            setContentView(message);
            return;
        }
        registerPlugin(DeepTutorFilesPlugin.class);
        super.load();
        // Capacitor may silently fall back after a listener setup error. Remove
        // that legacy interface so opaque presentation iframes never inherit it.
        bridge.getWebView().removeJavascriptInterface("androidBridge");
        ViewCompat.setOnApplyWindowInsetsListener(bridge.getWebView(), (view, insets) -> {
            Insets system = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            ViewGroup.LayoutParams params = view.getLayoutParams();
            if (params instanceof ViewGroup.MarginLayoutParams) {
                ((ViewGroup.MarginLayoutParams) params).setMargins(system.left, system.top, system.right, system.bottom);
                view.setLayoutParams(params);
            }
            return insets;
        });
    }
}
