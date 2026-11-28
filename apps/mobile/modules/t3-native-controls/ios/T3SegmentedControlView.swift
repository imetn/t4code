import ExpoModulesCore
import UIKit

final class T3SegmentedControlView: ExpoView {
  let onSelectionChange = EventDispatcher()
  private let control = UISegmentedControl()
  var labels: [String] = [] {
    didSet {
      guard labels != oldValue else { return }
      control.removeAllSegments()
      for (index, label) in labels.enumerated() {
        control.insertSegment(withTitle: label, at: index, animated: false)
      }
      control.apportionsSegmentWidthsByContent = labels.count > 4
      updateColors()
      updateSelection()
    }
  }
  var selectedIndex = -1 { didSet { updateSelection() } }
  var trackColor: UIColor = .secondarySystemBackground { didSet { if trackColor != oldValue { control.backgroundColor = trackColor } } }
  var selectedColor: UIColor = .secondarySystemFill { didSet { if selectedColor != oldValue { control.selectedSegmentTintColor = selectedColor } } }
  var textColor: UIColor = .label { didSet { if textColor != oldValue { updateColors() } } }
  var mutedColor: UIColor = .secondaryLabel { didSet { if mutedColor != oldValue { updateColors() } } }
  var appearance = "light" {
    didSet {
      guard appearance != oldValue else { return }
      overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(control)
    control.addTarget(self, action: #selector(selectionChanged), for: .valueChanged)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard control.frame != bounds else { return }
    UIView.performWithoutAnimation {
      control.frame = bounds
    }
  }

  private func updateSelection() {
    let index = labels.indices.contains(selectedIndex) ? selectedIndex : UISegmentedControl.noSegment
    // React echoes native selections while UIKit is still settling the glass lens.
    guard control.selectedSegmentIndex != index else { return }
    UIView.performWithoutAnimation {
      control.selectedSegmentIndex = index
      control.layoutIfNeeded()
    }
  }

  private func updateColors() {
    var normal: [NSAttributedString.Key: Any] = [.foregroundColor: mutedColor]
    var selected: [NSAttributedString.Key: Any] = [.foregroundColor: textColor]
    if labels.count > 5 {
      let font = UIFont.systemFont(ofSize: 12, weight: .medium)
      normal[.font] = font
      selected[.font] = font
    }
    control.setTitleTextAttributes(normal, for: .normal)
    control.setTitleTextAttributes(selected, for: .selected)
  }

  @objc private func selectionChanged() {
    onSelectionChange(["index": control.selectedSegmentIndex])
  }
}
