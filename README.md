# fm-synth-app

ブラウザ上で動作する、4オペレーター構成のFMシンセサイザーです。Web Audio APIを使用して音を生成し、ReactとTailwind CSSでUIを構築しています。

![image](https://github.com/user-attachments/assets/491337df-bae3-4199-ae0c-5c63c6d66f22)

https://you-sk.github.io/fm-synth-app/

-----

## ✨ 主な機能

* **4オペレーターFM音源**: 4つのオペレーター（サイン波、矩形波、ノコギリ波、三角波）を組み合わせて音作りができます。
* **多彩なパラメーター**: 各オペレーターの周波数比、デチューン、ADSRエンベロープ、レベルなどを調整可能です。
* **6種類のアルゴリズム**: オペレーターの接続順（アルゴリズム）を選択し、多彩なサウンドを生み出せます。
* **仮想キーボード**: マウス操作、またはPCのキーボード（A, W, S, E, D...）で演奏できます。
* **オクターブ変更**: キーボードの音域を上下に変更できます。
* **パッチの保存と読込**: 作成した音色設定（パッチ）をJSONファイルとしてエクスポート・インポートできます。

-----

## 💻 使用技術

* **React**: UIの構築
* **Web Audio API**: 音声処理とシンセサイザーエンジンの実装
* **Tailwind CSS**: スタイリング
* **Lucide React**: アイコン

-----

## 🚀 ローカルでの動かし方

1.  **リポジトリをクローン**:

    ```bash
    git clone https://github.com/you-sk/fm-synth-app.git
    ```

2.  **プロジェクトフォルダに移動**:

    ```bash
    cd fm-synth-app
    ```

3.  **依存パッケージをインストール**:

    ```bash
    npm install
    ```

4.  **開発サーバーを起動**:

    ```bash
    npm start
    ```

ブラウザで `http://localhost:3000` を開くと、シンセサイザーが表示されます。

-----

## 使い方

* **音作り**: 右側のオペレーターパネルで各パラメーターを調整します。ON/OFFでオペレーターの有効/無効を切り替えられます。
* **アルゴリズム選択**: 左側のグローバル設定で、オペレーターの組み合わせを変更します。
* **演奏**: 画面下部のキーボードをクリックするか、PCのキーボードで演奏します。
* **保存**: 気に入った音色が完成したら「エクスポート」ボタンで設定を保存できます。
* **読込**: 保存した設定は「インポート」ボタンでいつでも読み込めます。

## ライセンス

MITライセンスで公開しています。
