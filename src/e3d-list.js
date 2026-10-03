// Emoji that ship as bundled 3D images (public/e3d), mapped to their Fluent Emoji folder names.
export const E3D = {
  // category icons
  '🏦':'Bank', '🤝':'Handshake', '🏠':'House', '📶':'Antenna bars', '📱':'Mobile phone', '💡':'Light bulb', '🚗':'Automobile',
  '🏍️':'Motorcycle', '🎓':'Graduation cap', '🏥':'Hospital', '💊':'Pill', '🛒':'Shopping cart', '🍔':'Hamburger', '⛽':'Fuel pump',
  '✈️':'Airplane', '🎮':'Video game', '🎵':'Musical note', '📚':'Books', '👕':'T-shirt', '🐾':'Paw prints', '🎁':'Wrapped gift',
  '💳':'Credit card', '🧾':'Receipt', '💰':'Money bag', '🛠️':'Hammer and wrench', '👶':'Baby', '🏋️':'Person lifting weights',
  '☕':'Hot beverage', '🌐':'Globe with meridians', '📺':'Television', '🔌':'Electric plug', '💼':'Briefcase', '🪙':'Coin',
  '📡':'Satellite antenna', '💵':'Dollar banknote', '💻':'Laptop', '🏪':'Convenience store', '🎬':'Clapper board', '💧':'Droplet',
  '🔥':'Fire', '🧹':'Broom', '🏫':'School', '🛡️':'Shield', '🚜':'Tractor', '🏧':'Atm sign', '🅱️':'B button blood type', '🧺':'Basket',
  '🚕':'Taxi', '🛺':'Auto rickshaw', '📲':'Mobile phone with arrow', '🏗️':'Building construction', '🩺':'Stethoscope', '🧑‍🏫':'Teacher', '🏡':'House with garden', '🛵':'Motor scooter', '💍':'Ring', '📦':'Package',
  // app chrome
  '⏰':'Alarm clock', '☁️':'Cloud', '🗂️':'Card index dividers', '🔕':'Bell with slash', '✅':'Check mark button', '📄':'Page facing up',
  '📊':'Bar chart', '🎨':'Artist palette', '🔤':'Input latin letters', '🌙':'Crescent moon', '🔔':'Bell', 'ℹ️':'Information',
  '🚪':'Door', '💸':'Money with wings', '🚀':'Rocket', '📬':'Open mailbox with raised flag', '👤':'Bust in silhouette',
  '📍':'Round pushpin', '🏢':'Office building', '🎂':'Birthday cake', '📈':'Chart increasing', '📉':'Chart decreasing',
  '🧮':'Abacus', '🗓️':'Spiral calendar', '📷':'Camera', '🔒':'Locked', '🎉':'Party popper', '⚙️':'Gear', '📤':'Outbox tray',
  '🔋':'Battery', '👥':'Busts in silhouette', '📥':'Inbox tray', '⚡':'High voltage', '📲':'Mobile phone with arrow',
  // avatars
  '😎':'Smiling face with sunglasses', '🤓':'Nerd face', '🥳':'Partying face', '😇':'Smiling face with halo', '🙂':'Slightly smiling face',
  '🦁':'Lion', '🐯':'Tiger face', '🐼':'Panda', '🦊':'Fox', '🐨':'Koala', '🦄':'Unicorn', '🐶':'Dog face', '🐱':'Cat face',
  '🐵':'Monkey face', '🐸':'Frog', '🦉':'Owl', '🐧':'Penguin', '🌻':'Sunflower', '⭐':'Star', '🌈':'Rainbow'
};
export const AVATARS = ['😎','🤓','🥳','😇','🙂','🦁','🐯','🐼','🦊','🐨','🦄','🐶','🐱','🐵','🐸','🦉','🐧','🌻','⭐','🌈'];
export const e3dCode = e => [...String(e).replace(/️/g, '')].map(c => c.codePointAt(0).toString(16)).join('-');
