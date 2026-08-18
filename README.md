# 烘焙修正筆記本

純前端靜態網頁工具（`index.html` + `style.css` + `script.js`），記錄每次做蛋糕時如何從影片食譜換算容器與時間、成果如何、下次要改什麼。

## 部署到 GitHub Pages

1. 建一個新的 GitHub repository（public 或 private 皆可，若用 GitHub 免費方案的 Pages 功能，private repo 也能開啟 Pages）。
2. 把 `index.html`、`style.css`、`script.js` 一起上傳到 repo 根目錄（`index.html` 檔名不能改，另外兩個檔名要跟 `index.html` 裡的引用一致）。
3. 到 repo 的 **Settings → Pages**，Source 選擇 `Deploy from a branch`，Branch 選 `main` / `/ (root)`，儲存。
4. 等一兩分鐘，GitHub 會給你一個網址，格式通常是：
   `https://<你的帳號>.github.io/<repo名稱>/`

## 資料存在哪裡

- 所有紀錄、模具設定檔、照片，都存在**你目前使用的瀏覽器**的 localStorage 裡，不會上傳到 GitHub 或任何伺服器。
- 這代表：換一台電腦或手機開同一個網址，看到的會是**空的**，資料不會自動同步。
- 清瀏覽器資料 / 無痕模式，紀錄也會不見。建議定期用瀏覽器的「另存新檔」或之後我幫你加「匯出/匯入 JSON」功能備份。

## AI 轉換表格功能需要你自己的 API key

因為這是純前端靜態網站，沒有後端伺服器幫忙保管金鑰，所以「AI 轉換為表格」功能需要你自己到右上角「API 設定」貼上你自己的 Anthropic API key（去 [console.anthropic.com](https://console.anthropic.com/settings/keys) 申請）。

**請注意：**
- 這個 key 只存在你瀏覽器的 localStorage，但因為是純前端呼叫 API，任何打開瀏覽器開發者工具（F12）的人都看得到這個 key。
- **只在自己的裝置上使用**，不要在公用電腦、共用電腦上輸入 key。
- **絕對不要**把你的 key 寫進 `index.html` 原始碼再上傳到 GitHub（尤其是 public repo）——這會讓任何人都能盜用你的額度。目前的設計是 key 由使用者在瀏覽器介面手動輸入，不會出現在程式碼裡，請維持這個做法。
- 如果之後想在多台裝置或給其他人用，更安全的做法是架一個小型後端（例如 Cloudflare Worker）代為呼叫 API、把 key 藏在伺服器端，而不是放在瀏覽器裡——如果有需要我可以再幫你做。
