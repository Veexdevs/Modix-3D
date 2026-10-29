<p align="center">
  <img src="assets/splash-logo.png" alt="Modix 3D Logo" width="220" />
</p>

<h1 align="center">Modix 3D v2.0</h1>

<p align="center">
  <strong>Estúdio Mobile de Modelagem 3D, Escultura, Pintura de Texturas e Agente Multi-IA (Estilo Blender Mobile — Landscape / Tela Deitada)</strong><br/>
  Disponível nativamente como <code>.apk</code> (Android) e <code>.ipa</code> (iOS) compilados automaticamente via <strong>GitHub Actions</strong>.
</p>

<p align="center">
  <img src="assets/editor-preview.png" alt="Modix 3D Editor Landscape" width="900" />
</p>

---

## Download (`.apk` e `.ipa`)

Cada push ou execução na aba **[Actions](../../actions)** gera automaticamente os instaladores nativos:

- **`Modix-3D-APK` (`Modix-3D.apk`)**: Aplicativo Android assinado (esquemas V1 + V2), pronto para instalar diretamente em qualquer smartphone ou tablet Android em **tela deitada (`sensorLandscape` fullscreen imersivo)**.
- **`Modix-3D-IPA` (`Modix-3D.ipa`)**: Aplicativo iOS (`arm64` / `iphoneos`) assinado ad-hoc, pronto para instalação via **AltStore, SideStore, Sideloadly, TrollStore** ou Xcode, travado em **Landscape Left / Right** em tela cheia.

Para publicar também uma Release oficial com `.apk` e `.ipa` anexados:
1. Envie uma tag `v*` (ex.: `git tag v2.0.0 && git push origin v2.0.0`), **ou**
2. Na aba **Actions → Build Modix 3D Mobile (APK & IPA) → Run workflow**, marque `create_release: true`.

---

## Novidades da Versão 2.0

### 1. Chat de IA & Agente Multi-IA 3D (`OpenRouter`)
Botão **`✦ IA / Agente`** na barra superior abre a central de Inteligência Artificial com alternância instantânea entre dois modos:
- **Modo `IA` (Chat & Dúvidas)**: Responde perguntas técnicas de modelagem 3D, topologia, UVs e Roblox Studio com consciência da cena atual, **sem modificar nenhum objeto**.
- **Modo `Agente` (Pipeline Multi-IA Colaborativo)**: Orquestra múltiplas IAs especialistas trabalhando em conjunto via OpenRouter:
  1. **IA Arquiteta 3D**: Planeja proporções, partes estruturais, cortes geométricos, grupos e materiais.
  2. **IA Modeladora & Escultora**: Constrói primitivas, perfis extrudados (`add_extruded_polygon`), malhas torneadas (`add_lathe`), modificadores, cortes por plano 3D (`slice_mesh`), união (`join_objects`) e grupos (`group_objects`).
  3. **IA Artista de Texturas (em paralelo)**: Desenha texturas vetoriais `SVG` exclusivas em `512×512` convertidas em mapas `PNG` ou aplica texturas procedurais PBR automaticamente nos objetos criados.
  - Inclui **Undo 3D em 1 toque** para reverter qualquer criação inteira do Agente instantaneamente.

### 2. Operações Completas de Objetos, Hierarquia & Malhas
- **24 Formas 3D Prontas**: `Cube`, `Plane`, `Grid`, `UV Sphere`, `Ico Sphere`, `Cylinder`, `Cone`, `Torus`, `Capsule`, `Monkey`, `Wedge (Rampa Roblox)`, `Corner Wedge`, `Pyramid`, `Prism`, `Hex Cylinder`, `Pipe (Tubo Oco)`, `Arch (Arco)`, `Stairs (Escada)`, `Star 3D`, `Gear (Engrenagem)`, `Ring`, `Crystal`, `Heart 3D` e `Torus Knot`.
- **Explorer / Outliner Redimensionável**: Segure a barra inferior do Explorer e arraste para cima ou para baixo para ajustar o tamanho livremente por toque ou mouse.
- **Grupos / Coleções, Renomear, Copiar, Colar, Recortar & Unir**:
  - **Renomear** objetos e grupos (toque duplo no Explorer, menu `⋯` ou `F2`).
  - **Agrupar / Desagrupar** (`Ctrl+G`, botão `+` de grupo no Explorer, mover objetos entre coleções).
  - **Copiar (`Ctrl+C`), Recortar (`Ctrl+X`), Colar (`Ctrl+V`), Duplicar (`Shift+D`) e Deletar (`X`/`Del`)**.
  - **Unir Malhas (`Ctrl+J` / Join)** preservando transformações em espaço global + **Separar Partes Soltas (`Separate Loose Parts`)**.
  - **Recortar / Fatiar Malha 3D (`Slice / Cut 3D`)**: Corta qualquer objeto por plano `X`, `Y` ou `Z` mantendo um lado ou dividindo em 2 peças sólidas fechadas (`capped`).

### 3. Estúdio 2D de Desenho de Texturas & Pintura 3D Direta
- **Estúdio 2D (`512×512`)**: Pincel suave, aerógrafo, linha, retângulo, círculo, balde de tinta (`flood fill`), borracha, espelhamento X/Y, guia de grade UV, 25 níveis de Undo/Redo, importação de imagem da galeria e download `.png`.
- **14 Geradores Procedurais Instantâneos**: `Roblox Studs`, `Checker`, `Grid UV`, `Brick`, `Wood`, `Carbon Fiber`, `Metal Plate`, `Camo`, `Lava`, `Grass`, `Stone`, `Sci-Fi Panel`, `Gradient` e `Noise`.
- **Pintura 3D Direta na Viewport (`Texture Paint`)**: Pinte com o dedo diretamente sobre a superfície 3D do modelo com atualização a 60fps via `CanvasTexture` + projeções UV (`Box`, `Planar`, `Cylindrical`, `Spherical`) e repetição `Repeat X/Y`.

### 4. Hub Universal de Importação & Exportação (Compatível com Roblox Studio)
- **Exportação Otimizada para Roblox Studio (`.obj` + `.mtl` + `.png` e `.rbxmx`)**:
  - Conversão automática de coordenadas **Z-up → Y-up** (`det = +1` preservando normais externas sem faces invertidas), triangulação limpa `f v/vt/vn`, coordenadas UV completas para `MeshPart.TextureID` e exportação direta de modelos `.rbxmx`.
- **Formatos Exportados**: `.obj` (Roblox Y-up ou Blender Z-up), `.mtl`, `.rbxmx`, `.glb`, `.gltf`, `.usdz` (Apple AR), `.dae` (Collada), `.stl`, `.ply`, `.modix` e `.png`.
- **Formatos Importados (12 formatos)**: `.obj`, `.fbx`, `.glb`, `.gltf`, `.dae`, `.stl`, `.ply`, `.3mf`, `.amf`, `.svg` (extrusão automática para 3D), `.off`, `.rbxmx` e `.modix`.

---

## Compilação Local

```bash
npm install
npm run build
npx cap sync
```

- **Android APK**:
  ```bash
  cd android && ./gradlew assembleRelease
  ```
- **iOS IPA (macOS + Xcode)**:
  ```bash
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphoneos build
  ```
