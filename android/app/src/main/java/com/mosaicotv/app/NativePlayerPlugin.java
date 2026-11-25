package com.mosaicotv.app;

import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reproductor nativo (ExoPlayer / Media3). El video se dibuja DETRÁS del WebView,
 * que se vuelve transparente mientras se reproduce (igual que AVPlay en Tizen).
 */
@UnstableApi
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private ExoPlayer player;
    private PlayerView view;

    @Override
    public void load() {
        getActivity().runOnUiThread(this::ensureView);
    }

    private void ensureView() {
        if (view != null) return;
        View web = getBridge().getWebView();
        web.setBackgroundColor(Color.TRANSPARENT);
        ViewGroup parent = (ViewGroup) web.getParent();
        view = new PlayerView(getContext());
        view.setUseController(false);
        view.setFocusable(false);
        view.setKeepScreenOn(true);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setVisibility(View.GONE);
        parent.addView(view, 0, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void releasePlayer() {
        if (player != null) {
            player.release();
            player = null;
        }
        if (view != null) view.setPlayer(null);
    }

    private void emit(String state, String message) {
        JSObject o = new JSObject();
        o.put("state", state);
        if (message != null) o.put("message", message);
        notifyListeners("state", o);
    }

    @PluginMethod
    public void play(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta la url");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ensureView();
                releasePlayer();

                DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                        .setAllowCrossProtocolRedirects(true)
                        .setConnectTimeoutMs(15000)
                        .setReadTimeoutMs(20000)
                        .setUserAgent("VLC/3.0.20 LibVLC/3.0.20");

                player = new ExoPlayer.Builder(getContext())
                        .setMediaSourceFactory(new DefaultMediaSourceFactory(getContext()).setDataSourceFactory(http))
                        .build();
                view.setPlayer(player);
                view.setVisibility(View.VISIBLE);

                player.addListener(new Player.Listener() {
                    @Override
                    public void onPlaybackStateChanged(int state) {
                        if (state == Player.STATE_BUFFERING) emit("buffering", null);
                        else if (state == Player.STATE_READY) emit("ready", null);
                        else if (state == Player.STATE_ENDED) emit("ended", null);
                    }

                    @Override
                    public void onPlayerError(PlaybackException error) {
                        emit("error", error.getMessage());
                    }
                });

                MediaItem.Builder item = new MediaItem.Builder().setUri(url);
                if (url.toLowerCase().contains(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
                player.setMediaItem(item.build());
                player.prepare();
                player.setPlayWhenReady(true);
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            releasePlayer();
            if (view != null) view.setVisibility(View.GONE);
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        if (player != null) player.setPlayWhenReady(false);
    }

    @Override
    protected void handleOnResume() {
        if (player != null) player.setPlayWhenReady(true);
    }

    @Override
    protected void handleOnDestroy() {
        releasePlayer();
    }
}
