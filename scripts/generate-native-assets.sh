#!/usr/bin/env bash
set -euo pipefail

echo "Generating Modix 3D native Android & iOS icons and splash screens..."

ICON_SRC="assets/icon.png"
MARK_WHITE="public/brand/modix-mark-white.png"
SPLASH_LOGO="assets/splash-logo.png"

# 1. Android Launcher Icons (legacy + round + adaptive foreground in safe zone 66/108)
declare -A MIPMAP_SIZES=(
  ["mdpi"]="48:108"
  ["hdpi"]="72:162"
  ["xhdpi"]="96:216"
  ["xxhdpi"]="144:324"
  ["xxxhdpi"]="192:432"
)

for density in "${!MIPMAP_SIZES[@]}"; do
  IFS=":" read -r legacy fg <<< "${MIPMAP_SIZES[$density]}"
  dir="android/app/src/main/res/mipmap-${density}"
  mkdir -p "$dir"

  # Legacy square icon (pure black + white Modix mark)
  convert "$ICON_SRC" -resize "${legacy}x${legacy}" "PNG24:${dir}/ic_launcher.png"

  # Round icon with circular mask
  convert "$ICON_SRC" -resize "${legacy}x${legacy}" \
    \( -size "${legacy}x${legacy}" xc:none -fill white -draw "circle $((legacy/2)),$((legacy/2)) $((legacy/2)),1" \) \
    -alpha off -compose CopyOpacity -composite \
    "PNG32:${dir}/ic_launcher_round.png"

  # Adaptive foreground (transparent 108dp canvas with safe-zone ~56% mark)
  mark_sz=$(( fg * 56 / 100 ))
  convert "$MARK_WHITE" -resize "${mark_sz}x${mark_sz}" \
    -background none -gravity center -extent "${fg}x${fg}" \
    "PNG32:${dir}/ic_launcher_foreground.png"
done

# Remove unused Capacitor vector placeholders
rm -f android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml
rm -f android/app/src/main/res/drawable/ic_launcher_background.xml

# 2. Android Splash Screens (pure black #000000 + centered "Modix 3D" full logo)
convert "$SPLASH_LOGO" -resize 380x380 -background "#000000" -gravity center -extent 960x540 \
  "PNG24:android/app/src/main/res/drawable/splash.png"

declare -A LAND_SPLASH=(
  ["mdpi"]="480x320:180"
  ["hdpi"]="800x480:250"
  ["xhdpi"]="1280x720:360"
  ["xxhdpi"]="1600x960:460"
  ["xxxhdpi"]="1920x1280:560"
)
for density in "${!LAND_SPLASH[@]}"; do
  IFS=":" read -r dim logo_sz <<< "${LAND_SPLASH[$density]}"
  convert "$SPLASH_LOGO" -resize "${logo_sz}x${logo_sz}" \
    -background "#000000" -gravity center -extent "$dim" \
    "PNG24:android/app/src/main/res/drawable-land-${density}/splash.png"
done

declare -A PORT_SPLASH=(
  ["mdpi"]="320x480:180"
  ["hdpi"]="480x800:250"
  ["xhdpi"]="720x1280:360"
  ["xxhdpi"]="960x1600:460"
  ["xxxhdpi"]="1280x1920:560"
)
for density in "${!PORT_SPLASH[@]}"; do
  IFS=":" read -r dim logo_sz <<< "${PORT_SPLASH[$density]}"
  convert "$SPLASH_LOGO" -resize "${logo_sz}x${logo_sz}" \
    -background "#000000" -gravity center -extent "$dim" \
    "PNG24:android/app/src/main/res/drawable-port-${density}/splash.png"
done

# 3. iOS Universal 1024x1024 AppIcon (strict RGB PNG24 without alpha channel for Apple validation)
convert "$ICON_SRC" -resize 1024x1024 -background "#000000" -alpha remove -alpha off \
  "PNG24:ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"

# 4. iOS Universal 2732x2732 Dark Splash Screens ("Modix 3D" full logo on pure #000000)
for target in \
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png" \
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png" \
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png"; do
  convert "$SPLASH_LOGO" -resize 760x760 -background "#000000" -gravity center -extent 2732x2732 \
    "PNG24:${target}"
done

echo "All native Modix 3D icons and splash screens generated!"
