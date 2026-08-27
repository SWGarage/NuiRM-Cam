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
