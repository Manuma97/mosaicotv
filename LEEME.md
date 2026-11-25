# Mosaico TV — versión Android / Android TV

Misma app que la de Tizen (filas por categoría, tarjetas cuadradas, favoritos, buscador), empaquetada con Capacitor.
El video lo reproduce **ExoPlayer** (nativo): HLS (.m3u8), MPEG-TS (.ts) y MP4. La lista M3U se descarga con HTTP nativo, así que no hay problemas de CORS.

## Opción A — Sacar el APK sin instalar nada (GitHub)
1. Crea un repositorio en GitHub y sube el contenido de esta carpeta.
2. Pestaña **Actions → Compilar APK → Run workflow**.
3. Al terminar (unos 5-8 min), descarga el artefacto **MosaicoTV-apk** (dentro está `app-debug.apk`).

## Opción B — Compilar en tu PC
Requisitos: Node 20+, Android Studio (JDK 21 incluido).
    npm install
    npx cap sync android
    npx cap open android      # Build → Build APK(s)
El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Instalar en la TV / TV box / móvil
- TV con "Send Files to TV" o un pendrive: copia el APK, ábrelo y permite "orígenes desconocidos".
- Con ADB:  adb connect IP_DE_LA_TV:5555  y luego  adb install app-debug.apk
- En el móvil: pasa el APK y ábrelo (se ve a tamaño TV, escalado).

## Primer uso
Ajustes → pega la URL de tu lista M3U → Cargar lista.

## Mando
| Botón | Acción |
|---|---|
| Flechas | Moverse |
| OK | Reproducir |
| Mantener OK (o Menú / Rojo) | Favorito |
| ▲▼ o CH+/CH− (reproduciendo) | Cambiar de canal |
| Atrás | Volver / salir |
