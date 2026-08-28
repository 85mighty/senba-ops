/* 船場美術館 다국어 오버레이 (JA/EN/ZH) — React 번들 무수정, DOM 치환 방식 (2026-08-25) */
(function () {
  'use strict';
  // Vercel Web Analytics 커스텀 이벤트 큐 스텁 — index.html 의 /_vercel/insights/script.js 와 페어
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  var D = [
    ["電話で予約する","Book by phone","电话预约"],
    ["船場美術館","Senba Art Studio","船场美术馆"],
    ["ブランド紹介","About Us","品牌介绍"],
    ["体験コース","Courses","体验课程"],
    ["選ばれる理由","Why Choose Us","选择我们的理由"],
    ["ギャラリー","Gallery","画廊"],
    ["アクセス","Access","交通指南"],
    ["ご予約はこちら","Book Now","立即预约"],
    ["予約する","Reserve","预约"],
    ["トップ","Top","首页"],
    ["ご予約","Reservation","预约"],
    ["心斎橋で、","In Shinsaibashi,","在心斋桥，"],
    ["世界にひとつだけの作品を。","create a one-of-a-kind artwork.","创作世界上独一无二的作品。"],
    ["絵を描いて、くつろいで。お気に入りのドリンク片手に楽しむ、","Paint, relax, and enjoy with your favorite drink in hand —","一边画画一边放松，手拿喜欢的饮品尽情享受，"],
    ["大阪・心斎橋のアート体験カフェ「船場美術館」。","an art experience café in Shinsaibashi, Osaka: Senba Art Studio.","这里是大阪心斋桥的艺术体验咖啡厅「船场美术馆」。"],
    ["船場美術館での絵画体験の様子","Painting experience at Senba Art Studio","船场美术馆的绘画体验场景"],
    ["ぐるなびで予約する","Book Online","在线预约"],
    ["オンラインで予約する","Book Online","在线预约"],
    ["オンラインでご予約","Book Online","在线预约"],
    ["Instagramを見る","See our Instagram","查看Instagram"],
    ["船場美術館は、誰でも自由に絵を描きながらくつろげる、","Senba Art Studio is a relaxing space where anyone can freely paint —","船场美术馆是一家任何人都能自由绘画、放松身心的"],
    ["心斎橋のアート体験カフェです。","an art experience café in Shinsaibashi.","位于心斋桥的艺术体验咖啡厅。"],
    ["道頓堀・心斎橋でのお買い物やお散歩のついでに、ふらりと立ち寄れる場所。1〜2時間の体験で、旅の思い出や日常のリフレッシュにぴったりの、特別な時間をお過ごしいただけます。","Drop by casually while shopping or strolling around Dotonbori and Shinsaibashi. A 1–2 hour experience makes a perfect travel memory or everyday refresh.","逛道顿堀、心斋桥购物散步时可以顺便进来坐坐。1~2小时的体验，无论是作为旅行回忆还是日常放松，都能度过一段特别的时光。"],
    ["「絵なんて学校以来描いていない」という方もご安心ください。絵心がなくても大丈夫。スタッフが道具の使い方から仕上げまで、丁寧にサポートいたします。","Haven't painted since school? No worries — no artistic skill needed. Our staff will kindly guide you from handling the tools to the finishing touches.","「毕业后就再没画过画」的朋友也请放心。没有绘画天赋也没关系，工作人员会从工具使用到最后完成，全程细心指导。"],
    ["2023年3月のオープン以来、多くのお客様にお越しいただいています。エプロン・ベレー帽など、かわいい衣装もご用意していますので、画家になりきって体験をお楽しみください。","Since opening in March 2023, we have welcomed many guests. Cute outfits such as aprons and berets are provided — enjoy the experience like a real painter.","自2023年3月开业以来，我们迎接了众多客人。店内备有围裙、贝雷帽等可爱服饰，欢迎变身画家尽情体验。"],
    ["完全個室・1組貸切","Fully Private Rooms","完全包间·一组包场"],
    ["アトリエは各8帖ほどのゆったりした完全個室が全5部屋。大きな鏡やソファも備えたプライベート空間を1組さま貸切でご利用いただけるので、まわりを気にせずアートに没頭できます。おひとりさまでも同料金で個室を貸切利用いただけます。","We have 5 spacious private ateliers (about 13㎡ each) with large mirrors and sofas. Each room is reserved for one group only, so you can immerse yourself in art without distraction. Solo guests enjoy a private room at the same price.","共有5间约8叠大小的宽敞包间画室，配有大镜子和沙发。每间仅供一组客人包场使用，可以毫无顾虑地沉浸在艺术中。单人客人也可以以相同价格包场使用。"],
    ["ドローイング体験の様子","Drawing experience","绘画体验场景"],
    ["完全個室・お部屋は2時間制","Private room, 2-hour sessions","完全包间·每间2小时制"],
    ["ドローイング体験","Drawing Experience","绘画体验"],
    ["ご用意した下絵の上に、絵の具で自由に彩色していくアート体験です。道具はすべてセットでご用意。絵の具の使用量に制限はありませんので、手ぶらでお越しいただき、ご自身のペースで心ゆくまで制作をお楽しみください。","Freely add colors with paint over a prepared sketch. All tools are provided as a set, with no limit on paint usage — come empty-handed and enjoy creating at your own pace.","在准备好的底稿上用颜料自由上色的艺术体验。工具全套齐备，颜料用量不限。您可以空手前来，按自己的节奏尽情创作。"],
    ["ドローイング体験の料金表","Drawing experience price list","绘画体验价目表"],
    ["コース","Course","课程"],
    ["平日","Weekdays","平日"],
    ["土日祝","Weekends & Holidays","周末及节假日"],
    ["お一人様","per person","每人"],
    ["2時間コース","2-hour course","2小时课程"],
    ["3時間コース","3-hour course","3小时课程"],
    ["3,000円","¥3,000","3,000日元"],
    ["14:00〜18:00（前日までのご予約で12:45〜のご案内も可能）","14:00–18:00 (12:45– start available if booked by the previous day)","14:00~18:00（前一天前完成预约可安排12:45开始）"],
    ["3,200円","¥3,200","3,200日元"],
    ["3,700円","¥3,700","3,700日元"],
    ["4,200円","¥4,200","4,200日元"],
    ["3,500円","¥3,500","3,500日元"],
    ["4,000円","¥4,000","4,000日元"],
    ["体験の詳細","Experience Details","体验详情"],
    ["ご利用人数","Group size","使用人数"],
    ["1名様〜4名様（1組貸切）","1–4 people (private for one group)","1~4人（一组包场）"],
    ["ご来店時間","Visiting hours","到店时间"],
    ["10:00〜19:00（金・土・日祝は 21:00 まで）","10:00–19:00 (until 21:00 on Fri, Sat, Sun & holidays)","10:00~19:00（周五、六、日及节假日至21:00）"],
    ["セット内容","What's included","套装内容"],
    ["エプロン、ベレー帽（約20色）、腕カバー、アクリル絵の具、パレット、筆5本、水入りバケツ、タオル","Apron, beret (approx. 20 colors), arm covers, acrylic paints, palette, 5 brushes, water bucket, towel","围裙、贝雷帽（约20色）、袖套、丙烯颜料、调色盘、画笔5支、水桶、毛巾"],
    ["キャンバス（紙）サイズ","Canvas (paper) size","画布（纸）尺寸"],
    ["作品のお渡し","Taking your artwork home","作品交付"],
    ["完成作品はお持ち帰り用boxでお渡しします","Finished artworks are packed in a take-home box","完成的作品将装入专用礼盒供您带回"],
    ["飲食物の持ち込み自由","BYO food & drinks","可自带饮食"],
    ["初心者OK","Beginner friendly","新手友好"],
    ["お子様連れOK","Kids welcome","欢迎携带儿童"],
    ["デートに","For dates","适合约会"],
    ["ご友人同士で","With friends","适合朋友同行"],
    ["誕生日・記念日に","Birthdays & anniversaries","适合生日·纪念日"],
    ["猫の石膏ペイントコースの作品例","Cat plaster painting example","猫咪石膏彩绘作品示例"],
    ["準備中","Coming soon","筹备中"],
    ["猫の石膏ペイントコース","Cat Plaster Painting Course","猫咪石膏彩绘课程"],
    ["かわいい猫の石膏フィギュアに色付けして、当日お持ち帰りいただけるコースを現在準備中です。開始時期などの最新情報は、Instagramにてお知らせいたします。","A new course where you paint a cute cat plaster figure and take it home the same day is in preparation. Follow our Instagram for the latest updates.","为可爱的猫咪石膏摆件上色、当天即可带回家的课程正在筹备中。开始时间等最新信息将在Instagram公布。"],
    ["絵心不要","No skill needed","无需绘画基础"],
    ["下絵をご用意しているので、絵が苦手な方も大丈夫。スタッフが最初から最後まで丁寧にガイドします。","Sketches are prepared, so it's fine even if you're not good at drawing. Staff will guide you from start to finish.","我们备有底稿，不擅长画画也没关系。工作人员会从头到尾细心指导。"],
    ["フォトジェニックな空間","Photogenic space","上镜的空间"],
    ["ギャラリーのような店内で、完成した作品と一緒に思い出の一枚を。SNS映えする写真が撮れます。","Take a memorable photo with your finished artwork in our gallery-like interior — perfect for social media.","在如画廊般的店内，与完成的作品合影留念，拍出适合发社交媒体的美照。"],
    ["飲みもの持ち込み自由","BYO drinks","饮品可自带"],
    ["お気に入りのドリンクやお菓子を持ち込んで、くつろぎながら制作をお楽しみいただけます。","Bring your favorite drinks and snacks, and enjoy creating in a relaxed mood.","可自带喜欢的饮品和零食，边放松边享受创作。"],
    ["かわいい衣装で変身","Dress up cutely","可爱变装"],
    ["ベレー帽とエプロンをご用意。画家気分に変身して、制作前の記念撮影もお忘れなく。","Berets and aprons are provided. Transform into a painter and don't forget a photo before you start.","备有贝雷帽和围裙。变身画家后，别忘了在创作前拍照留念。"],
    ["掲載実績","Featured In","媒体报道"],
    ["テレビ・Webメディアでもご紹介いただいています。","We have been featured on TV and web media.","我们曾被电视及网络媒体报道。"],
    ["「おとなのソロ部」で紹介（2024年7月）","Featured in \"Otona no Solo-bu\" (July 2024)","「大人solo部」栏目介绍（2024年7月）"],
    ["るるぶ&more.","Rurubu & more.","Rurubu & more."],
    ["読売テレビ","Yomiuri TV","读卖电视台"],
    ["「大阪ほんわかテレビ」","\"Osaka Honwaka TV\"","「大阪Honwaka TV」"],
    ["ABCテレビ","ABC TV","ABC电视台"],
    ["「newsおかえり」","\"news Okaeri\"","「news Okaeri」"],
    ["Kintetsu News（近鉄ニュース）","Kintetsu News","近铁新闻"],
    ["2024年10月号","October 2024 issue","2024年10月号"],
    ["ギャラリー＆お客様の声","Gallery & Reviews","画廊与顾客评价"],
    ["お客様の声","Reviews","顾客评价"],
    ["料金は2時間で3000円とお手頃でしたが、その内容に大変満足しました！会場には必要なすべての画材が揃っており、特に何も持参する必要がない点がとても便利でした。初めて絵を描く方でも安心して楽しめる環境です。アートスペースはとても居心地が良く、集中して描くことができる雰囲気でした。2時間という時間も程よく、初心者でも無理なく楽しめました。完成した作品を持ち帰ることができるのも嬉しいポイントです。","At ¥3,000 for two hours the price was reasonable, and I was very satisfied! All the art supplies were provided, so it was convenient not to bring anything. It's a comfortable environment even for first-time painters, and the space had a cozy atmosphere where I could focus. Two hours was just right, and taking my finished work home was a lovely bonus.","2小时3000日元的价格很实惠，内容也非常令人满意！现场备齐了所有画材，什么都不用带非常方便。即使是第一次画画的人也能安心享受。艺术空间非常舒适，是能专心作画的氛围。2小时的时长恰到好处，新手也能轻松享受。完成的作品可以带回家也是加分点。"],
    ["Googleレビューより / Thao Chanさん","From Google Reviews / Thao Chan","来自Google评论 / Thao Chan"],
    ["遅れてしまったのにも関わらず、店員さんが優しく対応してくださって有難かったです。とても楽しめました!絵を持ち帰る際も箱に梱包されていたり、お値段以上に満足感ありました。また機会があったら利用します!!","Even though we arrived late, the staff kindly accommodated us. We had a great time! The painting was packed in a box to take home — great value beyond the price. We'll come again!!","虽然我们迟到了，店员依然亲切接待，非常感谢。玩得很开心！带画回家时还有礼盒包装，满足感超出价格。有机会还会再来！！"],
    ["Googleレビューより / しおんさん","From Google Reviews / Shion","来自Google评论 / Shion"],
    ["雨の日でも遊べる室内体験型スポット!自分で用意するものは無しで手ぶらで行けるのも嬉しい。ベレー帽とエプロンでペアルックに変身したら、まずは記念写真を忘れずに!そのあとは思うままに好きなように塗っていくだけ。絵の具触ったの中学生ぶりで懐かしい~!!とか話しながらあっという間の2時間。ソファーもあるからゆったり過ごすこともできた。楽しかったです!!","A great indoor spot even on rainy days! Nothing to prepare — just come empty-handed. Match outfits with berets and aprons, take a photo first, then paint however you like. \"First time touching paints since junior high!\" — two hours flew by chatting like that. There's a sofa too, so we could relax. So much fun!!","雨天也能玩的室内体验景点！不用自己准备任何东西，空手前往超方便。戴上贝雷帽、系上围裙变身情侣装后，先别忘了拍纪念照！之后就随心所欲地涂色。「初中之后第一次碰颜料，好怀念~！」聊着聊着2小时转眼就过去了。还有沙发可以悠闲休息。非常开心！！"],
    ["Googleレビューより / Fuu N.さん","From Google Reviews / Fuu N.","来自Google评论 / Fuu N."],
    ["店名","Name","店名"],
    ["船場美術館（Senba Art Studio）","Senba Art Studio","船场美术馆（Senba Art Studio）"],
    ["住所","Address","地址"],
    ["〒542-0081 大阪府大阪市中央区南船場4-9-11 レイシス心斎橋ビル 5階","Racis Shinsaibashi Bldg. 5F, 4-9-11 Minamisenba, Chuo-ku, Osaka 542-0081","〒542-0081 大阪府大阪市中央区南船场4-9-11 Racis心斋桥大厦 5楼"],
    ["Osaka Metro各線 四ツ橋駅から徒歩5分","5 min walk from Yotsubashi Station (Osaka Metro)","大阪地铁四桥站步行5分钟"],
    ["心斎橋駅からも徒歩圏内","Also within walking distance from Shinsaibashi Station","从心斋桥站步行也可到达"],
    ["営業時間","Opening Hours","营业时间"],
    ["10:00〜19:00 ／ [金・土・日祝] 10:00〜21:00","10:00–19:00 / Fri, Sat, Sun & holidays: 10:00–21:00","10:00~19:00 ／ [周五六日及节假日] 10:00~21:00"],
    ["定休日","Closed","定休日"],
    ["不定休","Irregular holidays","不定期休息"],
    ["電話","Phone","电话"],
    ["ぐるなびの予約ページへ","To online booking","前往在线预约页面"],
    ["Google Mapsで開く","Open in Google Maps","在Google地图中打开"],
    ["船場美術館（Senba Art Studio）の地図","Map of Senba Art Studio","船场美术馆地图"],
    ["今すぐご予約を","Book Your Visit Now","立即预约"],
    ["心斎橋観光のプランに、アート体験のひとときを。","Add an art experience to your Shinsaibashi itinerary.","为您的心斋桥观光行程增添一段艺术体验时光。"],
    ["完全予約制（当日のご予約も可能です）。","Reservation required (same-day bookings welcome).","完全预约制（当日预约也可）。"],
    ["ご予約はぐるなびから、24時間いつでも承ります。","Book online anytime, 24/7 — instant confirmation with prepayment.","在线预约，24小时随时受理（在线支付即时确认）。"],
    ["ぐるなびでご予約","Book Online","在线预约"],
    ["© 2026 船場美術館 Senba Art Studio","© 2026 Senba Art Studio","© 2026 船场美术馆 Senba Art Studio"],
    ["メインナビゲーション","Main navigation","主导航"],
    ["メニューを閉じる","Close menu","关闭菜单"],
    ["メニューを開く","Open menu","打开菜单"],
    ["セクションナビゲーション","Section navigation","栏目导航"],
    ["ヒーロー写真の切り替え","Switch hero photo","切换主图"],
    ["閉じる","Close","关闭"],
    ["もっと見る","See more","查看更多"],
    ["ギャラリーの切り替え","Switch gallery","切换画廊"],
    ["船場美術館 | A Drawing Cafe in Osaka","Senba Art Studio | A Drawing Cafe in Osaka","船场美术馆 | 大阪绘画咖啡厅"],
    ["大阪・心斎橋の完全個室ドローイングカフェ「船場美術館」","Fully private drawing café in Shinsaibashi, Osaka — Senba Art Studio","大阪·心斋桥的完全包间绘画咖啡厅「船场美术馆」"],
    ["LINEで送る","Share on LINE","用LINE发送"],
    ["Xでシェア","Share on X","分享到X"],
    ["コピーしました ✓","Copied ✓","已复制 ✓"],
    ["リンクをコピー","Copy link","复制链接"],
    ["このページをシェア","Share this page","分享本页"],
    ["シェア","Share","分享"],
    ["LINEでお問い合わせ","Contact via LINE","通过LINE咨询"]
  ];
  var PATTERNS = [
    [/^店内・作品のギャラリー写真\s*(\d+)$/, function (m, l) {
      return l === 'en' ? 'Gallery photo ' + m[1] : l === 'vi' ? 'Ảnh số ' + m[1] : '店内与作品照片 ' + m[1]; }],
    [/^(\d+)枚目の写真を表示$/, function (m, l) {
      return l === 'en' ? 'Show photo ' + m[1] : l === 'vi' ? 'Xem ảnh ' + m[1] : '显示第' + m[1] + '张照片'; }],
    [/^(\d+)枚目を表示$/, function (m, l) {
      return l === 'en' ? 'Show item ' + m[1] : l === 'vi' ? 'Xem mục ' + m[1] : '显示第' + m[1] + '张'; }],
    [/^電話をかける（(.+)）$/, function (m, l) {
      return l === 'en' ? 'Call ' + m[1] : l === 'vi' ? 'Gọi ' + m[1] : '拨打电话（' + m[1] + '）'; }],
    [/^(.+?)（(\d+)枚目）$/, function (m, l) {
      var inner = tr(m[1], l) || m[1];
      return l === 'en' ? inner + ' (photo ' + m[2] + ')' : l === 'vi' ? inner + ' (ảnh ' + m[2] + ')' : inner + '（第' + m[2] + '张）'; }]
  ];
  var VI = {
  "電話で予約する": "Đặt chỗ qua điện thoại",
  "船場美術館": "Senba Art Studio",
  "ブランド紹介": "Giới thiệu",
  "体験コース": "Các khóa trải nghiệm",
  "選ばれる理由": "Lý do chọn chúng tôi",
  "ギャラリー": "Thư viện ảnh",
  "アクセス": "Đường đi",
  "ご予約はこちら": "Đặt chỗ ngay",
  "予約する": "Đặt chỗ",
  "トップ": "Trang chủ",
  "ご予約": "Đặt chỗ",
  "心斎橋で、": "Tại Shinsaibashi,",
  "世界にひとつだけの作品を。": "tạo nên tác phẩm duy nhất trên thế giới.",
  "絵を描いて、くつろいで。お気に入りのドリンク片手に楽しむ、": "Vẽ tranh, thư giãn, nhâm nhi thức uống yêu thích —",
  "大阪・心斎橋のアート体験カフェ「船場美術館」。": "quán cà phê trải nghiệm nghệ thuật tại Shinsaibashi, Osaka: Senba Art Studio.",
  "船場美術館での絵画体験の様子": "Trải nghiệm vẽ tranh tại Senba Art Studio",
  "ぐるなびで予約する": "Đặt chỗ online",
  "オンラインで予約する": "Đặt chỗ online",
  "オンラインでご予約": "Đặt chỗ online",
  "Instagramを見る": "Xem Instagram",
  "船場美術館は、誰でも自由に絵を描きながらくつろげる、": "Senba Art Studio là không gian thư giãn nơi ai cũng có thể tự do vẽ tranh —",
  "心斎橋のアート体験カフェです。": "quán cà phê trải nghiệm nghệ thuật tại Shinsaibashi.",
  "道頓堀・心斎橋でのお買い物やお散歩のついでに、ふらりと立ち寄れる場所。1〜2時間の体験で、旅の思い出や日常のリフレッシュにぴったりの、特別な時間をお過ごしいただけます。": "Ghé qua tiện thể khi mua sắm hay dạo chơi ở Dotonbori, Shinsaibashi. Trải nghiệm 1–2 tiếng là kỷ niệm du lịch tuyệt vời hoặc khoảnh khắc thư giãn giữa đời thường.",
  "「絵なんて学校以来描いていない」という方もご安心ください。絵心がなくても大丈夫。スタッフが道具の使い方から仕上げまで、丁寧にサポートいたします。": "Chưa từng vẽ lại từ thời đi học? Đừng lo — không cần năng khiếu. Nhân viên sẽ tận tình hướng dẫn từ cách dùng dụng cụ đến khi hoàn thiện.",
  "2023年3月のオープン以来、多くのお客様にお越しいただいています。エプロン・ベレー帽など、かわいい衣装もご用意していますので、画家になりきって体験をお楽しみください。": "Từ khi khai trương tháng 3/2023, chúng tôi đã đón rất nhiều khách. Có sẵn tạp dề, mũ nồi xinh xắn — hãy hóa thân thành họa sĩ và tận hưởng trải nghiệm.",
  "完全個室・1組貸切": "Phòng riêng hoàn toàn",
  "アトリエは各8帖ほどのゆったりした完全個室が全5部屋。大きな鏡やソファも備えたプライベート空間を1組さま貸切でご利用いただけるので、まわりを気にせずアートに没頭できます。おひとりさまでも同料金で個室を貸切利用いただけます。": "5 phòng vẽ riêng rộng rãi (khoảng 13㎡ mỗi phòng) có gương lớn và sofa. Mỗi phòng chỉ dành cho một nhóm, giúp bạn thoải mái đắm mình vào nghệ thuật. Khách đi một mình cũng được dùng phòng riêng với cùng mức giá.",
  "ドローイング体験の様子": "Trải nghiệm vẽ tranh",
  "完全個室・お部屋は2時間制": "Phòng riêng, mỗi lượt 2 tiếng",
  "ドローイング体験": "Trải nghiệm vẽ tranh",
  "ご用意した下絵の上に、絵の具で自由に彩色していくアート体験です。道具はすべてセットでご用意。絵の具の使用量に制限はありませんので、手ぶらでお越しいただき、ご自身のペースで心ゆくまで制作をお楽しみください。": "Tự do tô màu lên bản phác thảo có sẵn. Dụng cụ được chuẩn bị trọn bộ, không giới hạn lượng màu — cứ đến tay không và sáng tác theo nhịp độ của riêng bạn.",
  "ドローイング体験の料金表": "Bảng giá trải nghiệm vẽ",
  "コース": "Khóa",
  "平日": "Ngày thường",
  "土日祝": "Cuối tuần & ngày lễ",
  "お一人様": "mỗi người",
  "2時間コース": "Khóa 2 tiếng",
  "3時間コース": "Khóa 3 tiếng",
  "3,000円": "3.000 yên",
  "3,200円": "3.200 yên",
  "14:00〜18:00（前日までのご予約で12:45〜のご案内も可能）": "14:00–18:00 (đặt trước một ngày có thể bắt đầu từ 12:45)",
  "3,700円": "3.700 yên",
  "4,200円": "4.200 yên",
  "3,500円": "3.500 yên",
  "4,000円": "4.000 yên",
  "体験の詳細": "Chi tiết trải nghiệm",
  "ご利用人数": "Số người",
  "1名様〜4名様（1組貸切）": "1–4 người (một nhóm bao trọn phòng)",
  "ご来店時間": "Giờ nhận khách",
  "10:00〜19:00（金・土・日祝は 21:00 まで）": "10:00–19:00 (đến 21:00 vào thứ 6, 7, CN & ngày lễ)",
  "セット内容": "Bao gồm",
  "エプロン、ベレー帽（約20色）、腕カバー、アクリル絵の具、パレット、筆5本、水入りバケツ、タオル": "Tạp dề, mũ nồi (khoảng 20 màu), bao tay áo, màu acrylic, bảng pha màu, 5 cọ vẽ, xô nước, khăn",
  "キャンバス（紙）サイズ": "Kích thước canvas (giấy)",
  "作品のお渡し": "Nhận tác phẩm",
  "完成作品はお持ち帰り用boxでお渡しします": "Tác phẩm hoàn thành được đóng hộp để mang về",
  "飲食物の持ち込み自由": "Được mang đồ ăn thức uống",
  "初心者OK": "Phù hợp người mới",
  "お子様連れOK": "Chào đón trẻ em",
  "デートに": "Hẹn hò",
  "ご友人同士で": "Đi cùng bạn bè",
  "誕生日・記念日に": "Sinh nhật & kỷ niệm",
  "猫の石膏ペイントコースの作品例": "Ví dụ tô tượng mèo thạch cao",
  "準備中": "Sắp ra mắt",
  "猫の石膏ペイントコース": "Khóa tô tượng mèo thạch cao",
  "かわいい猫の石膏フィギュアに色付けして、当日お持ち帰りいただけるコースを現在準備中です。開始時期などの最新情報は、Instagramにてお知らせいたします。": "Khóa tô màu tượng mèo thạch cao đáng yêu, mang về ngay trong ngày, đang được chuẩn bị. Thông tin mới nhất sẽ được thông báo trên Instagram.",
  "絵心不要": "Không cần năng khiếu",
  "下絵をご用意しているので、絵が苦手な方も大丈夫。スタッフが最初から最後まで丁寧にガイドします。": "Có sẵn bản phác thảo nên không giỏi vẽ cũng không sao. Nhân viên sẽ hướng dẫn tận tình từ đầu đến cuối.",
  "フォトジェニックな空間": "Không gian sống ảo",
  "ギャラリーのような店内で、完成した作品と一緒に思い出の一枚を。SNS映えする写真が撮れます。": "Chụp ảnh kỷ niệm cùng tác phẩm trong không gian như phòng tranh — ảnh đẹp lung linh để đăng mạng xã hội.",
  "飲みもの持ち込み自由": "Được mang thức uống",
  "お気に入りのドリンクやお菓子を持ち込んで、くつろぎながら制作をお楽しみいただけます。": "Mang theo thức uống và bánh kẹo yêu thích, vừa thư giãn vừa sáng tác.",
  "かわいい衣装で変身": "Hóa trang xinh xắn",
  "ベレー帽とエプロンをご用意。画家気分に変身して、制作前の記念撮影もお忘れなく。": "Có sẵn mũ nồi và tạp dề. Hóa thân thành họa sĩ và đừng quên chụp ảnh trước khi bắt đầu.",
  "掲載実績": "Truyền thông",
  "テレビ・Webメディアでもご紹介いただいています。": "Chúng tôi đã được giới thiệu trên truyền hình và báo mạng.",
  "るるぶ&more.": "Rurubu & more.",
  "「おとなのソロ部」で紹介（2024年7月）": "Giới thiệu trong \\\"Otona no Solo-bu\\\" (7/2024)",
  "読売テレビ": "Đài Yomiuri TV",
  "「大阪ほんわかテレビ」": "\\\"Osaka Honwaka TV\\\"",
  "ABCテレビ": "Đài ABC TV",
  "「newsおかえり」": "\\\"news Okaeri\\\"",
  "Kintetsu News（近鉄ニュース）": "Kintetsu News",
  "2024年10月号": "Số tháng 10/2024",
  "ギャラリー＆お客様の声": "Ảnh & Đánh giá",
  "お客様の声": "Đánh giá của khách",
  "料金は2時間で3000円とお手頃でしたが、その内容に大変満足しました！会場には必要なすべての画材が揃っており、特に何も持参する必要がない点がとても便利でした。初めて絵を描く方でも安心して楽しめる環境です。アートスペースはとても居心地が良く、集中して描くことができる雰囲気でした。2時間という時間も程よく、初心者でも無理なく楽しめました。完成した作品を持ち帰ることができるのも嬉しいポイントです。": "Giá 3.000 yên cho 2 tiếng rất hợp lý và tôi cực kỳ hài lòng! Mọi họa cụ cần thiết đều có sẵn, không phải mang gì theo, rất tiện. Người mới vẽ lần đầu cũng yên tâm. Không gian ấm cúng, dễ tập trung sáng tác. 2 tiếng là vừa đủ, người mới cũng thoải mái. Được mang tác phẩm về là điểm cộng tuyệt vời.",
  "Googleレビューより / Thao Chanさん": "Từ Google Reviews / Thao Chan",
  "遅れてしまったのにも関わらず、店員さんが優しく対応してくださって有難かったです。とても楽しめました!絵を持ち帰る際も箱に梱包されていたり、お値段以上に満足感ありました。また機会があったら利用します!!": "Dù chúng tôi đến muộn, nhân viên vẫn tiếp đón rất thân thiện. Rất vui! Tranh mang về còn được đóng hộp cẩn thận — xứng đáng hơn cả giá tiền. Có dịp nhất định sẽ quay lại!!",
  "Googleレビューより / しおんさん": "Từ Google Reviews / Shion",
  "雨の日でも遊べる室内体験型スポット!自分で用意するものは無しで手ぶらで行けるのも嬉しい。ベレー帽とエプロンでペアルックに変身したら、まずは記念写真を忘れずに!そのあとは思うままに好きなように塗っていくだけ。絵の具触ったの中学生ぶりで懐かしい~!!とか話しながらあっという間の2時間。ソファーもあるからゆったり過ごすこともできた。楽しかったです!!": "Điểm vui chơi trong nhà tuyệt vời cả ngày mưa! Không cần chuẩn bị gì, đến tay không cũng được. Đội mũ nồi, đeo tạp dề đôi rồi nhớ chụp ảnh kỷ niệm trước! Sau đó cứ tô màu theo ý thích. \\\"Lần đầu đụng màu vẽ từ hồi cấp 2, nhớ quá~!!\\\" — vừa trò chuyện 2 tiếng trôi qua lúc nào không hay. Có sofa nên rất thư thái. Vui lắm!!",
  "Googleレビューより / Fuu N.さん": "Từ Google Reviews / Fuu N.",
  "店名": "Tên quán",
  "船場美術館（Senba Art Studio）": "Senba Art Studio",
  "住所": "Địa chỉ",
  "〒542-0081 大阪府大阪市中央区南船場4-9-11 レイシス心斎橋ビル 5階": "Tầng 5, tòa nhà Racis Shinsaibashi, 4-9-11 Minamisenba, Chuo-ku, Osaka 542-0081",
  "Osaka Metro各線 四ツ橋駅から徒歩5分": "Cách ga Yotsubashi (Osaka Metro) 5 phút đi bộ",
  "心斎橋駅からも徒歩圏内": "Cũng có thể đi bộ từ ga Shinsaibashi",
  "営業時間": "Giờ mở cửa",
  "10:00〜19:00 ／ [金・土・日祝] 10:00〜21:00": "10:00–19:00 / Thứ 6, 7, CN & ngày lễ: 10:00–21:00",
  "定休日": "Ngày nghỉ",
  "不定休": "Nghỉ không cố định",
  "電話": "Điện thoại",
  "ぐるなびの予約ページへ": "Đến trang đặt chỗ online",
  "Google Mapsで開く": "Mở bằng Google Maps",
  "船場美術館（Senba Art Studio）の地図": "Bản đồ Senba Art Studio",
  "今すぐご予約を": "Đặt chỗ ngay hôm nay",
  "心斎橋観光のプランに、アート体験のひとときを。": "Thêm một trải nghiệm nghệ thuật vào lịch trình khám phá Shinsaibashi.",
  "完全予約制（当日のご予約も可能です）。": "Chỉ nhận khách đặt trước (có thể đặt trong ngày).",
  "ご予約はぐるなびから、24時間いつでも承ります。": "Đặt chỗ online 24/7, xác nhận ngay khi thanh toán.",
  "ぐるなびでご予約": "Đặt chỗ online",
  "© 2026 船場美術館 Senba Art Studio": "© 2026 Senba Art Studio",
  "メインナビゲーション": "Điều hướng chính",
  "メニューを閉じる": "Đóng menu",
  "メニューを開く": "Mở menu",
  "セクションナビゲーション": "Điều hướng theo mục",
  "ヒーロー写真の切り替え": "Chuyển ảnh chính",
  "閉じる": "Đóng",
  "もっと見る": "Xem thêm",
  "ギャラリーの切り替え": "Chuyển thư viện ảnh",
  "船場美術館 | A Drawing Cafe in Osaka": "Senba Art Studio | A Drawing Cafe in Osaka",
  "大阪・心斎橋の完全個室ドローイングカフェ「船場美術館」": "Quán cà phê vẽ tranh phòng riêng tại Shinsaibashi, Osaka — Senba Art Studio",
  "LINEで送る": "Gửi qua LINE",
  "Xでシェア": "Chia sẻ lên X",
  "コピーしました ✓": "Đã sao chép ✓",
  "リンクをコピー": "Sao chép liên kết",
  "このページをシェア": "Chia sẻ trang này",
  "シェア": "Chia sẻ",
  "LINEでお問い合わせ": "Liên hệ qua LINE"
  };
  var MAP = { en: {}, zh: {}, vi: VI };
  D.forEach(function (r) { MAP.en[r[0]] = r[1]; MAP.zh[r[0]] = r[2]; });
  var TITLES = {
    ja: '船場美術館 Senba Art Studio | 心斎橋のアートドローイングカフェ',
    en: 'Senba Art Studio | Art Drawing Cafe in Shinsaibashi, Osaka',
    zh: '船场美术馆 Senba Art Studio | 心斋桥艺术绘画咖啡厅',
    vi: 'Senba Art Studio | Quán cà phê vẽ tranh tại Shinsaibashi, Osaka'
  };
  var DESCS = {
    ja: '心斎橋・四ツ橋駅徒歩5分のアート体験カフェ「船場美術館」。完全個室のアトリエでゆったりドローイング体験。エプロンや絵の具などの道具はすべてご用意、手ぶらでOK。絵心がなくても大丈夫、当日のご予約も可能です。',
    en: 'Senba Art Studio — an art experience café 5 min from Yotsubashi Station, Shinsaibashi. Relax and paint in a fully private atelier. All tools provided, come empty-handed. No skill needed; same-day booking available.',
    zh: '船场美术馆——距四桥站步行5分钟的艺术体验咖啡厅。在完全包间的画室中悠闲享受绘画体验。围裙、颜料等工具全部备齐，空手前来即可。无需绘画基础，当日预约也可。',
    vi: 'Senba Art Studio — quán cà phê trải nghiệm nghệ thuật cách ga Yotsubashi 5 phút đi bộ, Shinsaibashi. Vẽ tranh thư giãn trong phòng riêng. Dụng cụ có sẵn, đến tay không. Không cần năng khiếu, nhận đặt chỗ trong ngày.'
  };
  var LS_KEY = 'senba-lang';
  var lang = 'ja';
  try { lang = localStorage.getItem(LS_KEY) || 'ja'; } catch (e) {}
  if (['ja','en','zh','vi'].indexOf(lang) < 0) lang = 'ja';
  // 예약 링크: [2026-08-28] 아직 전 언어 구루나비 유지 — Square 전환 시행일에 아래 플래그만 true 로.
  // true 가 되면 gnavi 링크가 Square 날짜 게이트(평일/토일축 판정 → 코스 딥링크)로 바뀐다.
  var USE_SQUARE_BOOKING = false;
  var SQUARE_BOOKING_URL = 'https://book.squareup.com/appointments/w10qd9b5byn80k/location/LCM2AJZHBA6SK';

  // ── 날짜 우선 예약 게이트 (2026-08-27) ──
  // Square 예약 페이지는 서비스 우선 흐름이 고정이라, 사이트 쪽에서 날짜를 먼저 받아
  // 평일/토일축을 판정한 뒤 해당 코스 딥링크로 보낸다. 공휴일 목록은 2027-12까지 내장(매년 갱신 필요).
  var SQ_SVC = {
    wd2: SQUARE_BOOKING_URL + '/services/FABHX3IQPWQQE4KYC5MXAZM7',
    wd3: SQUARE_BOOKING_URL + '/services/BRIKZPWIZVWKAIRICQYENSN3',
    we2: SQUARE_BOOKING_URL + '/services/BIRFETJ2QR424NXUOKXGTUV6',
    we3: SQUARE_BOOKING_URL + '/services/DEMA53S5XCUB3W7BNV66EMHK'
  };
  var JP_HOLIDAYS = ['2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23',
    '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21','2027-03-22','2027-04-29',
    '2027-05-03','2027-05-04','2027-05-05','2027-07-19','2027-08-11','2027-09-20','2027-09-23',
    '2027-10-11','2027-11-03','2027-11-23'];
  var GATE_T = {
    ja: { title: 'ご来店日を選択', sub: '日付によりコース料金が異なります', wd: '平日', we: '土日祝',
          c2: '2時間コース', c3: '3時間コース', go: 'この日で予約へ進む', close: '閉じる' },
    en: { title: 'Select your visit date', sub: 'Prices differ by weekday / weekend & holidays', wd: 'Weekday', we: 'Weekend / Holiday',
          c2: '2-hour course', c3: '3-hour course', go: 'Continue to booking', close: 'Close' },
    zh: { title: '选择到店日期', sub: '平日与周末/节假日价格不同', wd: '平日', we: '周末·节假日',
          c2: '2小时课程', c3: '3小时课程', go: '继续预约', close: '关闭' },
    vi: { title: 'Chọn ngày đến', sub: 'Giá khác nhau giữa ngày thường và cuối tuần/ngày lễ', wd: 'Ngày thường', we: 'Cuối tuần/Lễ',
          c2: 'Khóa 2 tiếng', c3: 'Khóa 3 tiếng', go: 'Tiếp tục đặt chỗ', close: 'Đóng' }
  };
  function isWeekendOrHoliday(ymd) {
    var d = new Date(ymd + 'T00:00:00+09:00');
    var dow = d.getUTCDay(); // +09:00 자정 → UTC 전날 15시라 요일 어긋남 방지 위해 로컬 파싱 사용
    d = new Date(ymd + 'T12:00:00');
    dow = d.getDay();
    return dow === 0 || dow === 6 || JP_HOLIDAYS.indexOf(ymd) >= 0;
  }
  function showDateGate() {
    var t = GATE_T[lang] || GATE_T.ja;
    var old = document.getElementById('senba-date-gate'); if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'senba-date-gate';
    wrap.innerHTML =
      '<div class="sdg-back"></div>' +
      '<div class="sdg-card" role="dialog" aria-modal="true">' +
      '<h3>' + t.title + '</h3><p class="sdg-sub">' + t.sub + '</p>' +
      '<input type="date" class="sdg-date">' +
      '<div class="sdg-type" hidden></div>' +
      '<div class="sdg-courses" hidden>' +
      '<a class="sdg-btn sdg-c2" target="_blank" rel="noopener"></a>' +
      '<a class="sdg-btn sdg-c3" target="_blank" rel="noopener"></a></div>' +
      '<button type="button" class="sdg-close">' + t.close + '</button></div>';
    var css = document.getElementById('senba-date-gate-css');
    if (!css) {
      css = document.createElement('style'); css.id = 'senba-date-gate-css';
      css.textContent =
        '#senba-date-gate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;font-family:inherit}' +
        '#senba-date-gate .sdg-back{position:absolute;inset:0;background:rgba(0,0,0,.45)}' +
        '#senba-date-gate .sdg-card{position:relative;background:#fff;border-radius:14px;padding:24px 22px;width:min(92vw,360px);box-shadow:0 10px 40px rgba(0,0,0,.25);text-align:center}' +
        '#senba-date-gate h3{margin:0 0 4px;font-size:18px}' +
        '#senba-date-gate .sdg-sub{margin:0 0 14px;font-size:12px;color:#666}' +
        '#senba-date-gate .sdg-date{font-size:16px;padding:10px 12px;border:1px solid #ccc;border-radius:8px;width:100%;box-sizing:border-box}' +
        '#senba-date-gate .sdg-type{margin:12px 0 4px;font-weight:700;font-size:14px}' +
        '#senba-date-gate .sdg-btn{display:block;margin:8px 0;padding:13px 10px;border-radius:8px;background:#1a7f3c;color:#fff;font-weight:700;text-decoration:none;font-size:15px}' +
        '#senba-date-gate .sdg-btn:hover{opacity:.92}' +
        '#senba-date-gate .sdg-close{margin-top:10px;border:0;background:transparent;color:#888;cursor:pointer;font-size:13px}';
      document.head.appendChild(css);
    }
    document.body.appendChild(wrap);
    var kill = function () { wrap.remove(); };
    wrap.querySelector('.sdg-back').addEventListener('click', kill);
    wrap.querySelector('.sdg-close').addEventListener('click', kill);
    var input = wrap.querySelector('.sdg-date');
    var today = new Date(); var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    input.min = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    input.addEventListener('change', function () {
      var ymd = input.value; if (!ymd) return;
      var we = isWeekendOrHoliday(ymd);
      var typeEl = wrap.querySelector('.sdg-type'); typeEl.hidden = false;
      typeEl.textContent = ymd + ' — ' + (we ? t.we : t.wd);
      var c = wrap.querySelector('.sdg-courses'); c.hidden = false;
      var b2 = wrap.querySelector('.sdg-c2'), b3 = wrap.querySelector('.sdg-c3');
      b2.textContent = t.c2 + ' ¥' + (we ? '3,700' : '3,200');
      b3.textContent = t.c3 + ' ¥' + (we ? '4,200' : '3,700');
      b2.href = we ? SQ_SVC.we2 : SQ_SVC.wd2;
      b3.href = we ? SQ_SVC.we3 : SQ_SVC.wd3;
      var track = function (course) {
        try { window.va('event', { name: 'booking_click_' + lang, data: { course: course, day: we ? 'weekend' : 'weekday', date: ymd } }); } catch (e) {}
      };
      b2.onclick = function () { track('2h'); };
      b3.onclick = function () { track('3h'); };
    });
  }
  var origHref = new WeakMap();
  function applyLinks() {
    if (!USE_SQUARE_BOOKING) return;   // 구루나비 원본 링크 그대로 (번들의 gnavi href 를 건드리지 않음)
    document.querySelectorAll('a[href]').forEach(function (a) {
      var o = origHref.get(a);
      if (o == null) {
        var h = a.getAttribute('href') || '';
        if (/gnavi\.co\.jp/.test(h)) { o = h; origHref.set(a, o); } else return;
      }
      var want = SQUARE_BOOKING_URL;
      if (a.getAttribute('href') !== want) a.setAttribute('href', want);
      if (!a.dataset.sdgBound) {
        a.dataset.sdgBound = '1';
        a.addEventListener('click', function (ev) { ev.preventDefault(); showDateGate(); });
      }
    });
  }
  var orig = new WeakMap();   // Text node → 원문(ja)
  var origAttr = new WeakMap(); // Element → {attr: ja}
  var ATTRS = ['alt', 'title', 'aria-label', 'placeholder'];

  function tr(ja, l) {
    if (l === 'ja') return ja;
    var hit = MAP[l][ja];
    if (hit) return hit;
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = ja.match(PATTERNS[i][0]);
      if (m) return PATTERNS[i][1](m, l);
    }
    return null;
  }
  function applyText(node) {
    var ja = orig.get(node);
    var cur = node.nodeValue;
    var t = cur ? cur.trim() : '';
    if (ja == null) {
      if (!t || !/[ぁ-んァ-ヶ一-龯]/.test(t)) { if (ja == null) return; }
      ja = t; orig.set(node, ja);
    }
    var out = lang === 'ja' ? ja : tr(ja, lang);
    if (out != null && cur.trim() !== out) node.nodeValue = cur.replace(cur.trim(), out);
  }
  function applyAttrs(el) {
    var store = origAttr.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      var ja = store && store[a] != null ? store[a] : (/[ぁ-んァ-ヶ一-龯]/.test(cur) ? cur : null);
      if (ja == null) continue;
      if (!store) { store = {}; origAttr.set(el, store); }
      if (store[a] == null) store[a] = ja;
      var out = lang === 'ja' ? ja : tr(ja, lang);
      if (out != null && cur !== out) el.setAttribute(a, out);
    }
  }
  function walk(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var n = root.nodeType === 3 ? root : w.nextNode();
    while (n) {
      if (n.nodeType === 3) applyText(n);
      else if (n.nodeType === 1) {
        if (n.id === 'senba-lang-toggle') { n = w.nextSibling ? w.nextSibling() : w.nextNode(); continue; }
        applyAttrs(n);
      }
      n = w.nextNode();
    }
  }
  // 중국어/베트남어 글리프가 Noto Sans JP 에 없어 굵기가 깨지는 문제 → 언어별 폰트 로드
  var fontLoaded = {};
  function ensureFont(l) {
    var conf = {
      zh: ['senba-font-sc', 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap'],
      vi: ['senba-font-vi', 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;700;900&display=swap']
    }[l];
    if (!conf || fontLoaded[l]) return;
    fontLoaded[l] = true;
    var link = document.createElement('link');
    link.id = conf[0]; link.rel = 'stylesheet'; link.href = conf[1];
    document.head.appendChild(link);
  }
  (function () {
    var st = document.createElement('style');
    st.textContent =
      'html[lang="zh-CN"] body, html[lang="zh-CN"] body *:not(#senba-lang-toggle):not(#senba-lang-toggle *){' +
      "font-family:'Noto Sans SC','Noto Sans JP',-apple-system,sans-serif !important;}" +
      'html[lang="vi"] body, html[lang="vi"] body *:not(#senba-lang-toggle):not(#senba-lang-toggle *){' +
      "font-family:'Noto Sans','Noto Sans JP',-apple-system,sans-serif !important;}" +
      // 영문/베트남어 긴 제목이 일본어용 자간·nowrap 때문에 모바일에서 잘리는 문제 보정
      'html[lang="en"] .hero__type-main,html[lang="vi"] .hero__type-main{letter-spacing:.12em !important;}' +
      '@media(max-width:768px){' +
      'html[lang="en"] .logo__name,html[lang="vi"] .logo__name{font-size:14px !important;letter-spacing:.02em !important;}' +
      'html[lang="en"] .logo__since,html[lang="vi"] .logo__since{letter-spacing:.08em !important;}' +
      'html[lang="en"] .hero__type-main,html[lang="vi"] .hero__type-main{font-size:24px !important;letter-spacing:.04em !important;white-space:normal !important;line-height:1.3;}' +
      'html[lang="en"] .hero__type-en,html[lang="vi"] .hero__type-en{letter-spacing:.25em !important;}' +
      '}';
    document.head.appendChild(st);
  })();
  function applyMeta() {
    document.title = TITLES[lang];
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', DESCS[lang]);
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : lang);
    ensureFont(lang);
  }
  var scheduled = false;
  function applyAll() {
    applyMeta();
    var root = document.getElementById('root');
    if (root) walk(root);
    applyLinks();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; applyAll(); });
  }

  // 국기 토글 — LINE 플로팅 버튼(우20/하90, 56px 원형) 바로 위에 같은 규격으로 쌓는다
  function starPts(cx, cy, R) {
    var r = R * 0.382, p = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R;
      p.push((cx + rad * Math.cos(a)).toFixed(2) + ',' + (cy + rad * Math.sin(a)).toFixed(2));
    }
    return p.join(' ');
  }
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(w) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 56 56'); s.setAttribute('width', w); s.setAttribute('height', w);
    return s;
  }
  function rect(s, x, y, w, h, fill) {
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill); s.appendChild(r); return r;
  }
  function poly(s, pts, fill) {
    var p = document.createElementNS(NS, 'polygon');
    p.setAttribute('points', pts); p.setAttribute('fill', fill); s.appendChild(p); return p;
  }
  function circle(s, cx, cy, r, fill) {
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', fill); s.appendChild(c); return c;
  }
  function flagSvg(code, size) {
    var s = svgEl(size);
    if (code === 'ja') { rect(s, 0, 0, 56, 56, '#fff'); circle(s, 28, 28, 12, '#bc002d'); }
    else if (code === 'en') {
      rect(s, 0, 0, 56, 56, '#fff');
      for (var i = 0; i < 7; i++) rect(s, 0, i * 8.62, 56, 4.31, '#b22234');
      rect(s, 0, 0, 28, 24, '#3c3b6e');
      for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 5; c2++)
        circle(s, 3.5 + c2 * 5.6 + (r2 % 2 ? 2.8 : 0), 3.5 + r2 * 5.6, 1.15, '#fff');
    }
    else if (code === 'zh') {
      rect(s, 0, 0, 56, 56, '#de2910');
      poly(s, starPts(14, 16, 8), '#ffde00');
      [[27,7],[31,12],[31,20],[27,25]].forEach(function (q) { poly(s, starPts(q[0], q[1], 3), '#ffde00'); });
    }
    else if (code === 'vi') { rect(s, 0, 0, 56, 56, '#da251d'); poly(s, starPts(28, 28, 13), '#ffff00'); }
    return s;
  }
  var LANGS = [
    ['ja', '日本語'],
    ['en', 'English'],
    ['zh', '中文'],
    ['vi', 'Tiếng Việt']
  ];
  function refreshActive(box) {
    box.querySelectorAll('button').forEach(function (x) {
      var on = x.getAttribute('data-lang') === lang;
      x.setAttribute('aria-pressed', String(on));
      x.className = on ? 'on' : '';
    });
  }
  function mountToggle() {
    if (document.getElementById('senba-lang-toggle')) return;
    var css = document.createElement('style');
    css.textContent =
      '#senba-lang-toggle{position:fixed;right:20px;bottom:156px;z-index:9999;display:flex;flex-direction:column;gap:10px}' +
      '#senba-lang-toggle button{width:56px;height:56px;border-radius:50%;overflow:hidden;padding:0;border:0;cursor:pointer;' +
      'background:#fff;box-shadow:rgba(0,0,0,.25) 0 4px 14px 0;display:flex;align-items:center;justify-content:center;' +
      'opacity:.92;transition:transform .15s,opacity .15s,box-shadow .15s}' +
      '#senba-lang-toggle button svg{width:100%;height:100%;display:block}' +
      '#senba-lang-toggle button:hover{transform:scale(1.06);opacity:1}' +
      '#senba-lang-toggle button.on{opacity:1;box-shadow:0 0 0 3px #fff,0 0 0 5px #1a7f3c,rgba(0,0,0,.25) 0 4px 14px 0}' +
      '@media(max-width:768px){#senba-lang-toggle{right:20px;bottom:156px;gap:8px}' +
      '#senba-lang-toggle button{width:48px;height:48px}}';
    document.head.appendChild(css);
    var box = document.createElement('div');
    box.id = 'senba-lang-toggle';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Language / 言語');
    LANGS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-lang', p[0]);
      b.setAttribute('aria-label', p[1]);
      b.setAttribute('title', p[1]);
      b.appendChild(flagSvg(p[0], 56));
      b.addEventListener('click', function () {
        lang = p[0];
        try { localStorage.setItem(LS_KEY, lang); } catch (e) {}
        try { window.va('event', { name: 'lang_switch', data: { lang: lang } }); } catch (e) {}
        refreshActive(box);
        applyAll();
      });
      box.appendChild(b);
    });
    document.body.appendChild(box);
    refreshActive(box);
  }

  function start() {
    mountToggle();
    applyAll();
    var mo = new MutationObserver(schedule);
    mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
