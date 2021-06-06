// ==UserScript==
// @name         jira_freee_working_time_checker
// @namespace    https://dominosoft.co.jp/
// @version      1.3g
// @description  freee APIを用いてJIRAのTimesheet Reports and Gadgetsテーブルに、freeeから取得した勤務時間を表示します。
// @author       taj
// @match        http://★★JIRAが動作しているアドレス★★/plugins/servlet/gadgets/ifr*
// @match        https://accounts.secure.freee.co.jp/public_api/authorize/*
// @connect      api.freee.co.jp
// @connect      accounts.secure.freee.co.jp
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  "use strict";
  console.log("⏲ START jira_freee_working_time_checker ⏲");

  const CLIENT_ID = "★★freee APIから取得する★★";
  const CLIENT_SECRET = "★★freee APIから取得する★★";
  const AUTH_URL = "★★freee APIから取得する★★";
  const COMPANY_ID = "★★freee APIから取得する★★";

  /**
   * リフレッシュトークンを保持するための永続ストレージクラス。
   */
  const persistentStorage = {
    KEY_REFRESH_TOKEN: "RefreshToken",
    setRefreshToken(token) {
      GM_setValue(this.KEY_REFRESH_TOKEN, token);
    },
    getRefreshToken() {
      return GM_getValue(this.KEY_REFRESH_TOKEN);
    },
    deleteRefreshToken() {
      GM_deleteValue(this.KEY_REFRESH_TOKEN);
    },
  };

  /**
   * API実行例外クラス。
   */
  class ApiException {
    static codes = {
      authenticationFailed: 1 /** 認可エラーが発生した。認可情報の取得が必要。 */,
      networkError: 2 /** API実行リクエストを送信できなかった。 */,
      otherApiError: 3 /** その他のAPIエラー */,
      unrelatedPage: 4 /** 他のアプリ用の認可画面だった。 */,
    };

    constructor(code, message) {
      this.code = code;
      this.message = message;
    }
  }

  /**
   * freeeの認可情報に関してあれこれするクラス。
   * ApiExceptionを使っています。
   * @see https://developer.freee.co.jp/tutorials/getting-access-token
   */
  class FreeeOAuth {
    /**
     * freeeの認可情報に関してあれこれするクラスのコンストラクタ。
     * @param clientId このツールのクライアントID
     * @param clientSecret このツールのクライアントシークレット
     * @param persistentStorage リフレッシュトークンを保存するための永続ストレージ
     */
    constructor(clientId, clientSecret, persistentStorage) {
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.storage = persistentStorage;
      this.lastTokenGotTime = new Date();
      this.lastTokenGotTime.setDate(this.lastTokenGotTime.getDate() - 1);
    }

    /**
     * APIの実行に必要なアクセストークンを取得する。
     * @returns アクセストークン
     * @throws ApiException : authenticationFailedがthrowされた場合は認可情報の取得が必要。
     */
    async getAccessToken() {
      if (
        new Date().getTime() - this.lastTokenGotTime.getTime() <
        23 * 60 * 60 * 1000
      ) {
        // console.log("⏲ 持っているアクセストークンが古くないのでそのまま使います。");
        return this.accessToken;
      }

      const refreshToken = this.storage.getRefreshToken();
      if (!refreshToken)
        throw new ApiException(
          ApiException.codes.authenticationFailed,
          "リフレッシュトークンがありません。"
        );

      const data = new FormData();
      data.append("grant_type", "refresh_token");
      data.append("client_id", this.clientId);
      data.append("client_secret", this.clientSecret);
      data.append("refresh_token", refreshToken);
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://accounts.secure.freee.co.jp/public_api/token",
          data: data,
          responseType: "json",
          onload: (res) => {
            const json = res.response;
            if (res.status === 200) {
              this.storage.setRefreshToken(json.refresh_token);
              this.accessToken = json.access_token;
              this.lastTokenGotTime = new Date();
              resolve(json.access_token);
            } else {
              const errorMessage = `⏲ アクセストークンが取得できませんでした。(${res.status} ${res.statusText})`;
              console.error(errorMessage);
              reject(
                new ApiException(
                  ApiException.codes.authenticationFailed,
                  errorMessage
                )
              );
            }
          },
          onerror: () =>
            reject(
              new ApiException(
                ApiException.codes.networkError,
                "freeeのAPIにアクセスできませんでした。"
              )
            ),
        });
      });
    }

    /**
     * 認可情報を登録する。
     * @param url 認可成功した時にコールバックされたURL
     */
    async registerAuthorizationInfo(url) {
      if (!url.includes(`client_id=${CLIENT_ID}`))
        throw new ApiException(
          ApiException.codes.unrelatedPage,
          "無関係なURLです。"
        );
      const authorizationCode = url.match(/\bcode=([0-9a-fA-F]+)\b/)[1];
      const refreshToken = await this.getRefreshToken(authorizationCode);
      this.storage.setRefreshToken(refreshToken);
    }

    /**
     * @private
     * 認可コードを使ってリフレッシュトークンを取得する。
     * @param authorizationCode 認可コード
     * @returns リフレッシュトークン
     */
    async getRefreshToken(authorizationCode) {
      const data = new FormData();
      data.append("grant_type", "authorization_code");
      data.append("client_id", this.clientId);
      data.append("client_secret", this.clientSecret);
      data.append("code", authorizationCode);
      data.append("redirect_uri", "urn:ietf:wg:oauth:2.0:oob");
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://accounts.secure.freee.co.jp/public_api/token",
          data: data,
          responseType: "json",
          onload: (res) => {
            if (res.status === 200) {
              const json = res.response;
              resolve(json.refresh_token);
            } else {
              const errorMessage = `⏲ リフレッシュトークンが取得できませんでした。(${res.status} ${res.statusText})`;
              console.error(errorMessage);
              reject(
                new ApiException(
                  ApiException.codes.authenticationFailed,
                  errorMessage
                )
              );
            }
          },
          onerror: () =>
            reject(
              new ApiException(
                ApiException.codes.networkError,
                "freeeのAPIにアクセスできませんでした。"
              )
            ),
        });
      });
    }
  }

  /**
   * freeeのAPIを実行するクラス。
   * ApiException、FreeeOAuthを使っています。
   */
  class FreeeApi {
    API_ENDPOINT = "https://api.freee.co.jp/hr";

    constructor(freeeOAuth) {
      this.oauth = freeeOAuth;
    }

    /**
     * ユーザーの従業員IDを取得する。
     * @returns 従業員ID
     */
    async getMyEmployeeId() {
      const res = await this.callApi("/api/v1/users/me", "GET");
      const employee = res.companies.filter((c) => c.id == COMPANY_ID)[0];
      return employee?.employee_id;
    }

    /**
     * 指定した従業員・日付の、勤務時間と勤怠メモを取得する。
     * @param employeeId 従業員ID
     * @param date 日付(Momentオブジェクト)
     * @returns [勤務時間(分), 勤怠メモ, 有給休暇率(1で全休)]
     * @see https://developer.freee.co.jp/docs/hr/reference#operations-%E5%8B%A4%E6%80%A0-show
     */
    async getWorkTimeMinutes(employeeId, date) {
      const url = `/api/v1/employees/${employeeId}/work_records/${this.formatDate(
        date
      )}?company_id=${COMPANY_ID}`;
      const res = await this.callApi(url, "GET");
      // このAPIでは1日の勤務時間が取れない...
      // 定時(8時間)と、月次で集計した場合の時間外勤務時間が取れる。
      // 他のAPIも微妙っぽいので、出社/退社時刻と休憩時間から気合で計算する。
      let workingMinutes = 0;
      if (res.clock_in_at && res.clock_out_at) {
        workingMinutes += moment(res.clock_out_at).diff(
          moment(res.clock_in_at),
          "minutes"
        );
        if (res.break_records)
          res.break_records.forEach((b) => {
            workingMinutes -= moment(b.clock_out_at).diff(
              moment(b.clock_in_at),
              "minutes"
            );
          });
      }
      return [workingMinutes, res.note, res.paid_holiday];
    }

    /**
     * 日付をフォーマットする。
     * @param date 日付(Momentオブジェクト)
     * @returns freee API用の日付文字列
     */
    formatDate(date) {
      return date.format("YYYY-MM-DD");
    }

    /**
     * @private
     * API実行時のレスポンスヘッダから必要な情報を抽出する。
     * @param responseHeaders レスポンスヘッダ文字列
     * @param headerName 値を抽出したいヘッダの名前
     * @returns 抽出した値
     */
    getResponseHeader(responseHeaders, headerName) {
      const lines = responseHeaders.split(/\n/);
      const headerLine = lines.filter((e) => e.startsWith(headerName));
      if (!headerLine) return;
      const m = headerLine[0].trim().match(`${headerName}: *(.*)$`);
      return m ? m[1] : undefined;
    }

    /**
     * @private
     * APIを実行する。
     * @param url URL
     * @param method メソッド('GET'/'POST')
     * @param data 送信データ
     * @returns レスポンス
     */
    async callApi(url, method, data) {
      console.log(`⏲ calling freee API... ${url}`);
      const accessToken = await this.oauth.getAccessToken();
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: method,
          url: this.API_ENDPOINT + url,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          data: JSON.stringify(data),
          responseType: "json",
          onload: (res) => {
            if (res.status === 200) {
              console.log(
                `⏲ freee API returned. limit remaining: ${this.getResponseHeader(
                  res.responseHeaders,
                  "x-ratelimit-remaining"
                )}`
              );
              resolve(res.response);
            } else if (res.status === 401) {
              const errorMessage = `⏲ アクセストークンが無効です。(${
                res.status
              } ${res.statusText})(${res.response?.code ?? "-"}: ${
                res.response?.message ?? "-"
              })`;
              console.error(errorMessage);
              reject(
                new ApiException(
                  ApiException.codes.authenticationFailed,
                  errorMessage
                )
              );
            } else {
              const errorMessage = `⏲ APIの実行でエラーが発生しました。(${
                res.status
              } ${res.statusText})(${res.response?.code ?? "-"}: ${
                res.response?.message ?? "-"
              })`;
              console.error(errorMessage);
              reject(
                new ApiException(ApiException.codes.otherApiError, errorMessage)
              );
            }
          },
          onerror: () =>
            reject(
              new ApiException(
                ApiException.codes.networkError,
                "freeeのAPIにアクセスできませんでした。"
              )
            ),
        });
      });
    }
  }

  /**
   * メインクラス
   */
  const workingTimeChecker = {
    freeeApi: new FreeeApi(
      new FreeeOAuth(CLIENT_ID, CLIENT_SECRET, persistentStorage)
    ),
    ROW_ID: "freeeWorkingTimeRow",

    /**
     * メイン処理
     * @param table 「時間管理」のテーブル
     */
    async main(table) {
      if (this.getFreeeWorkTimeRow(table)) return; // 処理済みなら何もしない
      const tableInfo = this.getInformationFromTable(table);
      const freeeRow = this.addFreeeWorkTimeRow(table, tableInfo);
      const spacer = document.createElement("div");
      spacer.style = "height: 5em";
      this.showMessage(freeeRow, spacer);
      try {
        const employeeId = await this.freeeApi.getMyEmployeeId();
        await this.renderFreeeInformation(tableInfo, freeeRow, employeeId);
        this.showMessage(
          freeeRow,
          document.createTextNode("Working time check (powered by freee API):")
        );
      } catch (e) {
        if (e.code == ApiException.codes.authenticationFailed) {
          this.showAuthenticationButton(freeeRow);
        } else {
          this.showMessage(freeeRow, document.createTextNode(e.message));
        }
      }
    },

    /**
     * 時間管理テーブルから情報を取得する
     * @param table 「時間管理」のテーブル
     * @returns 情報
     */
    getInformationFromTable(table) {
      const getDateFromTitle = (cell) => {
        const m = cell.title.match(/\d\d\d\d\/\d\d\/\d\d/);
        if (!m) return;
        const date = moment(m[0]);
        return date.isValid() ? date : undefined;
      };

      const parseWorkingTime = (cell) => {
        const text = cell.textContent.trim();
        const time = moment(0);
        text.split(/ +/).forEach((str) => {
          const unit = str.slice(-1);
          const num = Number(str.slice(0, -1));
          if (unit === "h") time.add(num, "hours");
          else if (unit === "m") time.add(num, "minutes");
        });
        return time.diff(moment(0), "minutes");
      };

      const dateRow = table.tHead.rows[0];
      const summaryRow = [...table.tBodies[0].rows].slice(-1)[0];
      console.assert(
        dateRow.cells.length == summaryRow.cells.length,
        `⏲ 列の数が合わない...🥺 (日付行:${dateRow.cells.length}列, 集計行:${summaryRow.cells.length}列)`
      );

      const existsData = dateRow.cells.length == summaryRow.cells.length;
      const totals = existsData
        ? [...summaryRow.cells].map((cell) => parseWorkingTime(cell))
        : [...dateRow.cells].map((cell) => 0);
      const classNames = existsData
        ? [...summaryRow.cells].map((cell) => cell.className)
        : [...dateRow.cells].map((cell) => "");

      return {
        columnNum: dateRow.cells.length,
        dates: [...dateRow.cells].map((cell) => getDateFromTitle(cell)),
        totals: totals,
        colSpans: [...dateRow.cells].map((cell) => cell.colSpan),
        classNames: classNames,
      };
    },

    /**
     * freeeの勤務時間情報を表示する行を取得する。
     * @param table 「時間管理」のテーブル
     * @returns 行
     */
    getFreeeWorkTimeRow(table) {
      return table.querySelector(`#${this.ROW_ID}`);
    },

    /**
     * freeeの勤務時間情報を表示する行を追加する
     * @param table 「時間管理」のテーブル
     * @param tableInfo テーブルから取得した情報
     * @returns 行
     */
    addFreeeWorkTimeRow(table, tableInfo) {
      const row = document.createElement("tr");
      row.id = this.ROW_ID;
      for (let i = 0; i < tableInfo.columnNum; ++i) {
        const td = document.createElement("td");
        td.colSpan = tableInfo.colSpans[i];
        td.className = tableInfo.classNames[i];
        row.appendChild(td);
      }
      table.tBodies[0].appendChild(row);
      return row;
    },

    /**
     * CSSを追加する。
     */
    addStyle() {
      GM_addStyle(`
          #${this.ROW_ID} { background-color: #3386501a; }
          #${this.ROW_ID} td.nonWorkedDay { background-color: #ffeedd; }
          #${this.ROW_ID} td div { font-family: "Segoe UI Emoji"; text-align: center; white-space: nowrap; }
        `);
    },

    /**
     * セルに何かを表示
     * @param cell セル
     * @param dom 表示したいDOM
     */
    showSomethingInCell(cell, dom) {
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      cell.appendChild(dom);
    },

    /**
     * セルにHTMLを表示
     * @param cell セル
     * @param html HTML文字列
     */
    showHtmlInCell(cell, html) {
      const div = document.createElement("div");
      div.innerHTML = html;
      this.showSomethingInCell(cell, div);
    },

    /**
     * メッセージ枠に何かを表示
     * @param freeeRow freeeの勤務時間情報を表示する行
     * @param messageDom 表示したいDOM
     */
    showMessage(freeeRow, messageDom) {
      const messageCell = freeeRow.cells[0];
      this.showSomethingInCell(messageCell, messageDom);
    },

    /**
     * 認可エラーが起きたので、認可取得のためのリンクを出す。
     * @param freeeRow freeeの勤務時間情報を表示する行
     */
    showAuthenticationButton(freeeRow) {
      persistentStorage.deleteRefreshToken();
      const span = document.createElement("span");
      span.title =
        "別のデバイスやブラウザから使用すると、保持している認可情報が無効になります。\n仕組み上これを回避するのは難しいので、都度認可操作を行ってください。🙇";
      span.appendChild(
        document.createTextNode("⚠️freee APIの認可情報が無効です。")
      );
      const a = document.createElement("a");
      a.href = AUTH_URL;
      a.target = "_blank";
      a.appendChild(document.createTextNode("認可情報を取得する"));
      span.appendChild(a);
      this.showMessage(freeeRow, span);
    },

    /**
     * 勤怠メモを絵文字にする。
     * @param note 勤怠メモ
     * @param paidHoliday 有給休暇率
     * @param date 日付(Momentオブジェクト)
     * @returns 絵文字の文字列
     */
    getNoteEmoticons(note, paidHoliday, date) {
      const stringTable = [
        // ★★勤怠メモに応じた絵文字テーブル（以下はdominosoftの例）★★
        /*
        { title: "終日テレワーク", label: "🏠" },
        { title: "半日テレワーク", label: "🏠🏢" },
        { title: "自転車", label: "🚴" },
        { title: "直出", label: "🔜" },
        { title: "直帰", label: "🔙" },
        */
      ];
      const res = [];
      stringTable.forEach(({ title, label }) => {
        if (note.includes(title))
          res.push(`<span title="${title}">${label}</span>`);
      });
      if (paidHoliday == 1.0) {
        const table = [
          "🌷",
          "✨",
          "🍜",
          "🍰",
          "⚽️",
          "⛳️",
          "🎸",
          "🎲",
          "🎮",
          "🛫",
          "🚀",
          "🚢",
          "🗿",
          "🗽",
          "⛲️",
          "🏰",
          "🏯",
          "🎡",
          "⛺️",
          "🎈",
          "💤",
          "🎨",
          "🛀",
        ];
        const emoji = table[(date.month() * 31 + date.date()) % table.length];
        res.push(`<span title="全休">${emoji}</span>`);
      } else if (paidHoliday == 0.5) res.push('<span title="半休">🌛</span>');
      return res.join("");
    },

    /**
     * '*h *m'形式の時間文字列を得る。
     * @param minutes 分
     * @returns '*h *m'形式の時間文字列
     */
    getTimeString(minutes) {
      const hours = Math.floor(minutes / 60);
      return `${hours > 0 ? hours + "h " : ""}${minutes % 60}m`;
    },

    /**
     * freeeから勤務情報を取得し、画面に表示する。
     * @param tableInfo テーブルから取得した情報
     * @param freeeRow freeeの勤務時間情報を表示する行
     * @param employeeId 従業員ID
     */
    async renderFreeeInformation(tableInfo, freeeRow, employeeId) {
      const zip = (arr1, arr2, arr3) =>
        arr1.map((e1, i) => [e1, arr2[i], arr3[i]]);
      await Promise.all(
        zip(tableInfo.dates, tableInfo.totals, freeeRow.cells).map(
          async ([date, jiraTime, cell]) => {
            if (!date || date > moment()) return;
            const [freeeTime, note, paidHoliday] =
              await this.freeeApi.getWorkTimeMinutes(employeeId, date);
            if (!freeeTime && !paidHoliday) return;

            const showInfos = [];
            if (jiraTime == freeeTime) {
              showInfos.push("✔");
            } else {
              showInfos.push(
                `<span title="合計作業時間が勤務時間と一致していません。">❌</span>`
              );
              showInfos.push(`${this.getTimeString(freeeTime)}`);
              const diff = jiraTime - freeeTime;
              showInfos.push(
                `(${diff > 0 ? "-" : "+"}${this.getTimeString(Math.abs(diff))})`
              );
            }
            const noteEmojis = this.getNoteEmoticons(note, paidHoliday, date);
            if (noteEmojis) showInfos.push(noteEmojis);

            this.showHtmlInCell(cell, showInfos.join("<br>"));
          }
        )
      );
    },
  };

  // メイン処理
  function main() {
    // 「時間管理」のテーブルが追加されるのを監視する。
    const target = document.documentElement || document.body;
    const observer = new MutationObserver((records) => {
      const timeSheet = document.querySelector(
        "div#jira div.results-wrap div.pagingtable table#issuetable"
      );
      if (timeSheet) workingTimeChecker.main(timeSheet);
    });
    observer.observe(target, { childList: true, subtree: true });
    workingTimeChecker.addStyle();
  }

  // 認可画面の処理
  async function processInAuthorizeScreen(url) {
    await workingTimeChecker.freeeApi.oauth.registerAuthorizationInfo(url);
    alert(
      "⏲ jira_freee_working_time_checkerより ⏲\n" +
        "freee APIの認可情報を保存しました。\n" +
        "このタブを閉じて、元の画面を再読み込みしてください。"
    );
  }

  // このスクリプトを実行しているのが何の画面か判断して、処理を実行する。
  if (
    location.href.startsWith(
      "https://accounts.secure.freee.co.jp/public_api/authorize/"
    )
  )
    processInAuthorizeScreen(location.href);
  else main();

  console.log("⏲ END jira_freee_working_time_checker. ⏲");
})();
