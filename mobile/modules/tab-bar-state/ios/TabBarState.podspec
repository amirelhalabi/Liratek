Pod::Spec.new do |s|
  s.name           = 'TabBarState'
  s.version        = '1.0.0'
  s.summary        = 'Reports whether the iOS 26 tab bar is minimized.'
  s.author         = 'LiraTek'
  s.homepage       = 'https://liratek.shop'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
