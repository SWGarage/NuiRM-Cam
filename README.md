# NuiRM-Camera

スマートフォンブラウザ向けの「バーチャルぬい撮り」最小動作版です。

## この版に入っているもの

- スマホカメラ表示
- `.vrm` ファイルのローカル読み込み
- カメラ映像の上へのVRM合成
- 1本指ドラッグによるVRMのX/Y移動
- Scaleスライダー
- Rotation X / Y / Zスライダー
- VRMに定義されたExpression一覧の動的生成
- 基本ポーズ / 片手上げ
- ポーズ左右反転
- カメラ + VRMのJPEG撮影

## この版ではまだ入れていないもの

- ライティング設定UI
- Directional Lightの方向ドラッグUI
- 環境光設定UI
- VRMのみへのGlow/Bloom
- カメラ背景Blur
- ポーズプリセットの外部JSON化
- 撮影解像度・画角の詳細設定

コード上ではThree.jsのSceneとカメラ背景を分けているため、これらは後から追加可能です。

## 起動方法

カメラAPIを使うため、HTMLファイルを直接 `file://` で開くのではなく、
`localhost` または HTTPS 上で実行してください。

Pythonが入っているPCなら、このフォルダで:

```bash
python -m http.server 8000
```

その後PCでは:

```text
http://localhost:8000
```

を開きます。

### スマホ実機で試す場合

通常のLAN内HTTPアクセスではスマホ側のカメラAPIが拒否される場合があります。
実機試験ではHTTPSのテストサーバーへ置く方法が確実です。

## ライブラリ

CDNから以下を読み込みます。

- Three.js 0.180.0
- @pixiv/three-vrm 3.x

そのため初回起動時にはインターネット接続が必要です。

## 操作

1. 「カメラ開始」を押してカメラ権限を許可
2. 「VRM読込」からVRMファイルを選択
3. 画面上をドラッグしてアバターを移動
4. 「調整」でScale / XYZ回転
5. 「ポーズ」でプリセットと左右反転
6. 「表情」でVRM内のExpressionを選択
7. 下部の丸いシャッターボタンでJPEG保存

## 注意

MVPなので、VRMごとのボーン構成・初期姿勢・モデルサイズ差に対する自動補正は最低限です。
特にポーズはHumanoidボーンを前提としています。


## v0.2変更点

- 保存画像をプレビューと同じアスペクト比に修正
- 撮影ボタンを「調整 / ポーズ / 表情」タブの上へ移動
- 2本指ピンチによるScale操作を追加
- Scale最大値を5へ変更
- Rotate Yを0〜360°へ変更
- Rotate Y初期値を180°へ変更


## v0.3変更点

- プロジェクト名を `NuiRM-Camera` に変更
- HTML titleを `NuiRM-Camera` に変更
- 撮影画像名を `NuiRM-yyyy-mm-dd-HHmmss.jpg` に変更
- Rotate Y表示初期値を180°に統一
- ピンチ中のXY移動誤作動なし・保存写真上のVRM位置ずれなしを実機確認済みとして記録


## v0.4変更点

- Rotate X/Y/Zをカメラ（画面）基準の固定軸からQuaternion合成する方式へ変更
- 回転合成順を Yaw(Y) → Pitch(X) → Roll(Z) に変更
- LIGHTタブを追加
- 主光源の色・強度を追加
- 主光源方向をドラッグ式XYパッドで操作可能に変更
- 環境光の色・強度を追加
- UnrealBloomPassによるGlowを追加
- 背景はHTML video、BloomはThree.js側だけで行うためGlow対象はVRMのみ


## v0.5変更点

- `UnrealBloomPass` を廃止し、カメラ映像とGlow処理を完全分離
- 通常VRM Canvasとは別にGlow専用透明Canvasを追加
- GlowはVRMのみに適用し、カメラ映像を覆わない構成へ変更
- 撮影画像にもVRM専用Glowを合成
- Glow Strength初期値を `0.10` に変更
- 主光源Y方向の操作範囲を `-180°〜180°` に変更


## v0.6変更点

- Rotate Zスライダーの操作方向を反転
  - 左端 `180°`
  - 中央 `0°`
  - 右端 `-180°`
- Glow機能を一時凍結し、UI・専用Canvas・レンダラー・撮影合成・関連状態を削除
- LIGHTタブは主光源と環境光のみ維持
- 描画構成を `camera video + VRM transparent canvas` に簡略化


## v0.7変更点

- Focal Length機能を追加
  - 24–70mm
  - 初期値 24mm
  - 24 / 28 / 35 / 50mm クイックプリセット
  - 35mm判換算の操作値としてThree.js PerspectiveCameraへ反映
- リセット時は24mmへ戻る
- iPhone/iPadの撮影後保存を改善
  - 対応環境ではWeb Share APIでJPEGをiOS共有シートへ渡す
  - 「画像を保存」を選択すると写真ライブラリへ保存できる
  - 利用できない環境では従来のダウンロード方式へフォールバック


## v0.7 統合更新

- VRM 0.x / 1.x の差異について、以下は現状処理を維持
  - モデル正面方向 / Rotate Y=180°
  - poses.json Quaternion → Normalized Bone
  - Expression一覧取得
  - MToon等のマテリアル表示
  - SpringBone
  - VRMロード後の初期スケール・位置
- `poses.json` をルート直下から読み込み、ポーズUIを自動生成
- `lights.json` をルート直下から読み込み、日中/夕方/夜/室内プリセットを自動生成
- ライティングプリセットは主光源/環境光の色と強度のみ変更し、Directionは維持
- iOS / AndroidともWeb Share APIを優先して撮影JPEGを共有シートへ渡す
- Web Share非対応時のみダウンロードへフォールバック


## v0.7 DEBUG build

マテリアルの鋭いハイライト原因確認用にDEBUGタブを追加。

VRM読込後に以下を表示します。

- VRM metaVersion
- マテリアル総数
- 各マテリアルの name / type / constructor
- MToon / MeshStandardMaterial / MeshPhysicalMaterial 判定
- metalness / roughness
- specularIntensity / specularColor
- ior / reflectivity / envMapIntensity
- clearcoat / sheen
- emissive / opacity / transparent
- MToonの主要ライティング関連プロパティ
- そのマテリアルを使用しているMesh名
- 現在のDirectionalLight / AmbientLightの色とIntensity
- RendererのtoneMapping等

「コピー」ボタンで結果をクリップボードへコピーできます。
このDEBUG機能は読み取り専用で、マテリアル値を変更しません。


## Roughness Verify build 3

This diagnostic build compares the raw glTF value stored inside the VRM/GLB
with the Three.js material value after loading.

Check the DEBUG report for:

- `NuiRMDebug: 3`
- `verificationBuild: "roughness-verify-final"`
- `rawGltfMaterials[].pbrMetallicRoughness.roughnessFactor`
- `materials[].properties.roughness`
- `roughnessComparison[]`

Interpretation:

- `rawRoughnessFactor = 0`, `threeRoughness = 0`
  - The VRM/GLB already stores roughness 0. Three.js is reading it correctly.
- `rawRoughnessFactor = 1`, `threeRoughness = 0`
  - The discrepancy occurs during loading/material conversion.
- `rawRoughnessFactor = 1`, `threeRoughness = 1`
  - The value is propagated correctly.
